import log from 'bristol';
import handlebars from 'handlebars';
import highlightjs from 'highlight.js';
import fs from 'fs-extra';
import marked from 'marked';
import omitDeep from 'omit-deep-lodash';
import path from 'path';

log.addTarget('console');

marked.setOptions({
    // Runs highlight on found code-blocks
    highlight: code => {
        return highlightjs.highlightAuto(code).value;
    }
});

/** The path to the original source code and Doxi JSON */
const codeSrcPath = './codesrc';
/** The path that the HTML will write to **/
const outputDirPath = './output';
/** The path to the Handlebar templates */
const templateDirPath = './src/templates';
/** The path to the class template */
const templatePath = path.join(templateDirPath, 'class.hbs');
/** The path that the HTML will write to **/
const htmlOutputDir = path.join(outputDirPath, 'html');
/** The path that contains the Doxi JSON **/
const jsonOutputDir = path.join(`${codeSrcPath}/output`, 'json');

/**
 * @method prepareOutputDirectory Ensures the existence of the HTML output directory.
 * We empty the directory if it exists, otherwise, we create it.
 */
async function prepareOutputDirectory() {
    // TODO: Add a choice on whether to clear the HTML cache
    try {
        await fs.emptyDir(htmlOutputDir);
    } catch (ex) {
        await fs.mkdir(htmlOutputDir);
    }
}

/**
 * @method writeHTML Joins the data with the handlebars template and writes the
 * results to file
 * @param {*} classTemplate
 * @param {Object} data
 */
const writeHTML = async(classTemplate, data = {}) => {
    const {className} = data;

    if (!className) {
        log.error('no class name found');
    }

    const fileName = `${className}.html`;
    const htmlFileWritePath = path.join(htmlOutputDir, fileName);
    const templateContent = classTemplate(data);

    try {
        await fs.writeFile(htmlFileWritePath, templateContent);
    } catch (ex) {
        log.error('write html error', ex);
    }

    log.info(`${fileName} written`);
};

/**
 * @method getItemsByType Returns the set of items associated with a particular member type.
 * Also prepares the text within each item.
 * @param {Array} classItems
 * @param {String} type The type of member item (methods, properties, etc)
 */
const getItemsByType = (classItems = [], type) => {
    const itemsByTypeArray = classItems.filter(item => item['$type'] === type);
    let items = [];

    if (itemsByTypeArray) {
        const [itemsByType = {}] = itemsByTypeArray;
        ({items = []} = itemsByType);

        if (items && items.length) {
            items.forEach(item => {
                const {text = ''} = item;
                // TODO: Figure out why item text code blocks are indenting strangely
                item.text = prepareText(text);
            });
        }
    }

    return items;
};

/**
 * @method cleanData Removes items from the data object that will not be
 * needed by the Handlebars template.
 * @param {Object} data
 */
const cleanData = data => {
    const omissions = 'src';
    return omitDeep(data, omissions);
};

/**
 * @method convertLinkTags Converts JavaDoc style links into HTML
 * @param {String} html
 */
const convertLinkTags = html => {
    const regex = /['`]*\{\s*@link(?:\s+|\\n)(\S*?)(?:(?:\s+|\\n)(.+?))?\}['`]*/g;
    const convertedLinks = html.replace(regex, (match, link, text = '') => {
        link = link.replace('!','-').trim();
        const memberName = link.substring(link.indexOf('-') + 1);
        text = text || memberName;

        if (link.includes('#') && link[0] !== '#') {
            link = link.replace('#', '.html#');
        } else {
            link += '.html';
        }

        return `<a href="${link}">${text}</a>`;
    });

    return convertedLinks;
};

/**
 * @method convertImageTags Converts JavaDoc style images into HTML
 * @param {String} html
 */
const convertImageTags = html => {
    const regex = /{\s*@img(?:\s+|\\n)(\S*?)(?:(?:\s+|\\n)(.+?))?\}['`]*/g;
    return html.replace(regex, (match, image) => {
        return `<img src="${image}" />`;
    });
};

/**
 * @method prepareText Prepares the text string by marking it up and converting JavaDoc
 * style tags to HTML.
 * @param {String} text
 */
const prepareText = text => {
    text = marked(text);
    text = convertLinkTags(text);
    text = convertImageTags(text);
    return text;
};

/**
 * @method prepareData Models the data object
 * @param {Object} fileContent
 */
const prepareData = async fileContent => {
    const {global: globalBlock} = fileContent;
    const [classInfo] = globalBlock.items;
    const {
        text: classText = '',
        name: className,
        items: classItems = []
    } = classInfo;

    if (!className) {
        log.error('Could not find a class name',);
    }

    const markedClassText = prepareText(classText);
    const configs = getItemsByType(classItems, 'configs');
    const events = getItemsByType(classItems, 'events');
    const methods = getItemsByType(classItems, 'methods');
    const properties = getItemsByType(classItems, 'properties');

    const data = {
        className,
        classText: markedClassText,
        configs,
        events,
        methods,
        properties
    };

    const cleanedData = cleanData(data);
    return cleanedData;
};

async function main() {
    await prepareOutputDirectory();

    const classTemplateSource = await fs.readFile(templatePath, 'utf8');
    const classTemplate = handlebars.compile(classTemplateSource);
    const jsonFiles = await fs.readdir(jsonOutputDir);
    const filteredJSONFiles = jsonFiles.filter(file => {
        return path.extname(file).toLowerCase() === '.json';
    });

    for (const file of filteredJSONFiles) {
        const cleanFilePath = path.join(jsonOutputDir, file);
        const fileContent = await fs.readJson(cleanFilePath);
        const data = await prepareData(fileContent);

        try {
            await writeHTML(classTemplate, data);
        } catch (ex) {
            log.error('error writing HTML', ex);
        }
    }
}

main();
