// ==UserScript==
// @name         网页关键词查询工具高级版
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  统计表单中关键词的匹配次数
// @author       Your name
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

// 修改表单选择器配置,增加更多元素类型
const FORM_SELECTORS = {
    inputs: [
        'input[type="text"]',
        'input[type="search"]',
        'input[type="email"]',
        'input[type="tel"]',
        'input[type="url"]',
        'input[type="number"]',
        'input[type="password"]'
    ].join(','),
    textAreas: 'textarea',
    contentEditable: '[contenteditable="true"]',
    // 增加常见文本容器
    textContainers: [
        'p',
        'div',
        'span',
        'article',
        'section',
        'pre',
        'code',
        'label',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'li',
        'td',
        'th',
        'caption',
        'figcaption',
        'blockquote',
        'cite'
    ].join(','),
    angularInputs: [
        '[nz-input]',
        '[formControlName]',
        '[ng-reflect-model]',
        '[ng-model]',
        '.ant-input',
        '.ng-untouched',
        '.ng-pristine',
        'nz-form-control',
        'nz-form-label'
    ].join(',')
};

// 将配置常量合并和简化
const CONFIG = {
    STORAGE_KEYS: {
        INCLUDE_DOMAINS: 'includeDomains',
        EXCLUDE_DOMAINS: 'excludeDomains'
    }
};

// 添加一个用于存储最新匹配结果的全局变量
let latestMatchResults = null;

(function() {
    'use strict';

    // 修改样式定义,添加导出按钮样式
    GM_addStyle(`
        .keywords-dialog {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0);
            z-index: 10000;
            min-width: 320px;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .keywords-textarea {
            width: 100%;
            height: 200px;
            margin: 10px 0;
            padding: 8px;
            box-sizing: border-box;
            border: 1px solid #ccc;
            border-radius: 4px;
            resize: vertical;
            font-size: 14px;
        }
        .match-counter {
            position: fixed !important;
            right: 20px !important;
            bottom: 0vh !important;
            padding: 10px 15px !important;
            border-radius: 6px !important;
            z-index: 2147483647 !important;
            font-size: 14px !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
            line-height: 1.5 !important;
            white-space: nowrap !important;
            max-height: 70vh !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            pointer-events: auto !important; /* 允许点击 */
            background: rgba(255, 255, 0, 0.8) !important;
        }
        .match-counter .count {
            color: #ff0000 !important;
            font-weight: bold !important;
        }
        .export-btn {
            background: #4CAF50 !important;
            color: white !important;
            border: none !important;
            padding: 5px 10px !important;
            border-radius: 4px !important;
            cursor: pointer !important;
            font-size: 12px !important;
            margin-top: 8px !important;
            width: 100% !important;
        }
        .export-btn:hover {
            background: #45a049 !important;
        }
        .match-counter .keyword {
            cursor: pointer;
            text-decoration: underline;
            color: #0066cc;
            margin-right: 5px;
        }
        .match-counter .keyword:hover {
            color: #003366;
        }
        .highlight-match {
            background-color: #ffeb3b;
            outline: 2px solid #ffc107;
        }
         /* 添加过渡效果 */
        .highlight-match {
            transition: background-color 0.3s ease-out, outline 0.3s ease-out;
        }
        /* 表单元素高亮样式 */
        input.highlight-match,
        textarea.highlight-match,
        [contenteditable].highlight-match,
        [nz-input].highlight-match,
        .ant-input.highlight-match {
            background-color: #fff3cd !important;
            border-color: #ffc107 !important;
            box-shadow: 0 0 0 0.2rem rgba(255, 193, 7, 0.25) !important;
            outline: none !important;
            transition: all 0.3s ease-out !important;
        }

        /* 普通元素高亮样式保持不变 */
        .highlight-match:not(input):not(textarea):not([contenteditable]):not([nz-input]):not(.ant-input) {
            background-color: #ffeb3b !important;
            outline: 2px solid #ffc107 !important;
        }
    `);

    // 修改清理文本函数，只清理不可见字符
    function cleanText(text) {
        return text
            // 清理所有空白字符（空格、制表符、换页符、换行符等）
            .replace(/[\s\uFEFF\xA0]+/g, '')
            .trim();
    }

    // 关键词存储相关函数
    function saveKeywords(keywords) {
        GM_setValue('highlightKeywords', keywords.filter(k => k.length > 0));
    }

    function getKeywords() {
        return GM_getValue('highlightKeywords', []);
    }

    // 修改创建关键词设置对话框函数
    function createKeywordsDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
        `;

        const dialog = document.createElement('div');
        dialog.className = 'keywords-dialog';

        // 创建取消函数
        const closeDialog = () => {
            document.body.removeChild(overlay);
            document.body.removeChild(dialog);
            // 移除全局函数
            delete window.saveAndClose;
        };

        dialog.innerHTML = `
            <h3>设置关键词</h3>
            <textarea class="keywords-textarea" placeholder="请输入关键词，每行一个">${getKeywords().join('\n')}</textarea>
            <div style="text-align: right">
                <button class="cancel-btn">取消</button>
                <button class="save-btn">保存</button>
            </div>
        `;

        // 使用事件监听器替代内联onclick
        dialog.querySelector('.cancel-btn').addEventListener('click', closeDialog);

        dialog.querySelector('.save-btn').addEventListener('click', () => {
            const textarea = dialog.querySelector('.keywords-textarea');
            const keywords = textarea.value.split('\n').map(cleanText).filter(k => k.length > 0);
            saveKeywords(keywords);
            closeDialog();
            updateCounter();
        });

        // ESC键关闭对话框
        const handleEsc = (event) => {
            if (event.key === 'Escape') {
                closeDialog();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);

        // 点击遮罩层关闭对话框
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeDialog();
            }
        });

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
    }

    // 防抖函数
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // 修改导出功能，使用HTML格式
    function exportMatchedElements() {
        if (!latestMatchResults || Object.keys(latestMatchResults).length === 0) {
            alert('当前没有匹配结果可导出');
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `关键词匹配结果_${timestamp}.html`;

        let content = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>关键词匹配结果导出</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .keyword-section { margin-bottom: 30px; }
        .keyword-header { background: #f0f0f0; padding: 10px; margin-bottom: 15px; }
        .match-item { border: 1px solid #ddd; padding: 15px; margin-bottom: 15px; }
        .match-content { background: #f8f8f8; padding: 10px; margin: 10px 0; }
        .match-xpath { font-family: monospace; word-break: break-all; }
        .match-html { background: #f5f5f5; padding: 10px; margin-top: 10px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>关键词匹配结果</h1>
    <p>导出时间: ${new Date().toLocaleString()}</p>
`;

        Object.entries(latestMatchResults).forEach(([keyword, elements]) => {
            content += `
    <div class="keyword-section">
        <div class="keyword-header">
            <h2>关键词: ${keyword}</h2>
            <p>匹配次数: ${elements.length}</p>
        </div>
`;

            elements.forEach((elem, index) => {
                content += `
        <div class="match-item">
            <h3>[${index + 1}] 元素信息:</h3>
            <p>类型: ${elem.element.tagName || '文本节点'}</p>
            <div class="match-content">
                <strong>内容:</strong><br>${elem.content.trim()}
            </div>
`;
                if (elem.element.id) {
                    content += `            <p>ID: ${elem.element.id}</p>\n`;
                }
                if (elem.element.className) {
                    content += `            <p>类名: ${elem.element.className}</p>\n`;
                }
                content += `
            <p class="match-xpath">XPath: ${getXPath(elem.element)}</p>
            <pre class="match-html">完整HTML:\n${elem.element.outerHTML || elem.element.textContent}</pre>
        </div>
`;
            });
            content += `    </div>\n`;
        });

        content += `
</body>
</html>`;

        const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 获取元素的XPath
    function getXPath(element) {
        if (!element) return '';
        if (element.nodeType === Node.TEXT_NODE) {
            element = element.parentNode;
        }
        if (!element) return '';

        const paths = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let index = 0;
            let hasFollowingSiblings = false;
            for (let sibling = element.previousSibling; sibling; sibling = sibling.previousSibling) {
                if (sibling.nodeType !== Node.DOCUMENT_TYPE_NODE &&
                    sibling.nodeName === element.nodeName) {
                    index++;
                }
            }
            hasFollowingSiblings = false;
            for (let sibling = element.nextSibling; sibling && !hasFollowingSiblings; sibling = sibling.nextSibling) {
                if (sibling.nodeName === element.nodeName) {
                    hasFollowingSiblings = true;
                }
            }
            const tagName = element.nodeName.toLowerCase();
            const pathIndex = (index || hasFollowingSiblings) ? `[${index + 1}]` : '';
            paths.unshift(tagName + pathIndex);
            element = element.parentNode;
        }
        return '/' + paths.join('/');
    }

    // 修改 getTextContent 函数对 Angular 元素的处理
    function getTextContent(element) {
        // Angular 表单元素特殊处理
        if (element.hasAttribute('nz-input') ||
            element.classList.contains('ant-input') ||
            element.hasAttribute('formControlName')) {

            // 按优先级获取值
            return element.getAttribute('ng-reflect-model') || // Angular 绑定值
                   element.getAttribute('value') ||            // 原生值
                   element.value ||                           // 当前值
                   element.textContent ||                     // 文本内容
                   '';
        }

        // 处理禁用状态的输入框
        if (element.classList.contains('ant-input-disabled') ||
            element.hasAttribute('disabled')) {
            return element.value ||
                   element.getAttribute('value') ||
                   element.textContent ||
                   '';
        }

        // 处理只读状态的输入框
        if (element.hasAttribute('readonly') ||
            element.classList.contains('ant-input-readonly')) {
            return element.value ||
                   element.getAttribute('value') ||
                   element.textContent ||
                   '';
        }

        // 处理表单元素
        if (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement) {
            // 检查是否是 ng-zorro 输入框
            if (element.hasAttribute('nz-input')) {
                // 优先获取绑定值
                return element.getAttribute('ng-reflect-model') ||
                       element.value ||
                       element.defaultValue || '';
            }
            if (element.type !== 'hidden' &&
                element.type !== 'submit' &&
                element.type !== 'button' &&
                element.type !== 'reset') {
                return element.value || element.defaultValue || '';
            }
            return '';
        }

        // 处理可编辑元素
        if (element.isContentEditable) {
            return element.innerText || '';
        }

        // 获取元素的所有直接文本内容，不包括子元素的文本
        let textContent = '';
        const childNodes = element.childNodes;
        for (let i = 0; i < childNodes.length; i++) {
            const node = childNodes[i];
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                if (text) {
                    textContent += text + ' ';
                }
            }
        }

        return textContent.trim();
    }

    // 修改更新计数器显示函数
    function updateCounter() {
        const keywords = getKeywords();
        // 确保有关键词时才显示浮层
        if (!keywords || !keywords.length) {
            const counter = document.querySelector('.match-counter');
            if (counter) {
                counter.remove();
            }
            return;
        }

        // 创建或获取浮层
        let counter = document.querySelector('.match-counter');
        if (!counter) {
            counter = document.createElement('div');
            counter.className = 'match-counter';
            document.body.appendChild(counter);

            // 设置初始内容
            counter.innerHTML = '正在统计...';
        }

        // 创建每个关键词的匹配统计
        const matchCounts = {};
        keywords.forEach(keyword => {
            matchCounts[keyword] = 0;
        });

        // 添加匹配元素收集对象
        const matchedElements = {};
        keywords.forEach(keyword => {
            matchedElements[keyword] = [];
        });

        // 获取所有文本元素，确保包含所有需要的选择器
        const allTextElements = document.querySelectorAll(
            [
                // 明确列出所有需要的 input 类型
                'input[type="text"]',
                'input[type="search"]',
                'input[type="email"]',
                'input[type="tel"]',
                'input[type="url"]',
                'input[type="number"]',
                'input[type="password"]',
                FORM_SELECTORS.textAreas,
                FORM_SELECTORS.contentEditable,
                FORM_SELECTORS.textContainers,
                FORM_SELECTORS.angularInputs  // 添加 Angular 选择器
            ].filter(Boolean).join(',')
        );

        // 修改文本采集逻辑
        function shouldSkipNode(node) {
            // 跳过脚本、样式、注释节点
            if (node.nodeType === Node.COMMENT_NODE ||
                node.nodeName === 'SCRIPT' ||
                node.nodeName === 'STYLE' ||
                node.nodeName === 'META' ||
                node.nodeName === 'LINK') {
                return true;
            }

            // 不要跳过表单元素
            if (node instanceof HTMLInputElement ||
                node instanceof HTMLTextAreaElement ||
                node.isContentEditable) {
                return false;
            }

            // 跳过有特定属性的非表单节点
            const skipAttributes = [
                'onclick', 'onmouseover', 'onmouseout', 'onchange',
                'data-', 'aria-', 'role', 'class', 'id', 'style',
                'href', 'src', 'alt', 'title'
            ];

            if (node.nodeType === Node.ELEMENT_NODE) {
                for (let attr of skipAttributes) {
                    if (attr.endsWith('-')) {
                        // 检查以特定前缀开头的属性
                        for (let nodeAttr of node.attributes) {
                            if (nodeAttr.name.startsWith(attr)) {
                                return true;
                            }
                        }
                    } else if (node.hasAttribute(attr)) {
                        return true;
                    }
                }
            }

            return false;
        }

        // 修改 getTextContent 函数以避免重复匹配
        function getTextContent(element) {
            // 如果元素的任何父元素已经被匹配过，则跳过
            if (element.closest('[data-matched]')) {
                return '';
            }

            // 处理表单元素
            if (element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement) {
                if (element.type !== 'hidden' &&
                    element.type !== 'submit' &&
                    element.type !== 'button' &&
                    element.type !== 'reset') {
                    return element.value || element.defaultValue || '';
                }
                return '';
            }

            // 处理可编辑元素
            if (element.isContentEditable) {
                return element.innerText || '';
            }

            // 获取元素的所有直接文本内容，不包括子元素的文本
            let textContent = '';
            const childNodes = element.childNodes;
            for (let i = 0; i < childNodes.length; i++) {
                const node = childNodes[i];
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent.trim();
                    if (text) {
                        textContent += text + ' ';
                    }
                }
            }

            return textContent.trim();
        }

        // 在 updateCounter 函数中修改数字匹配的正则表达式
        function createNumberRegex(number) {
            // 处理数字前后可能出现的字符类型
            return new RegExp(
                // (?<!) 和 (?<=[^]) 是零宽负向后发断言
                // (?!) 和 (?=[^]) 是零宽负向前发断言
                // \p{Unified_Ideograph} 匹配任何中文字符
                `(?<!\\d)(?<!\\.)${number}(?!\\d)(?!\\.)`,
                'g'
            );
        }

        // 清除之前的匹配标记
        document.querySelectorAll('[data-matched]').forEach(elem => {
            elem.removeAttribute('data-matched');
        });

        // 创建一个 Set 来存储已处理的 XPath
        const processedPaths = new Set();

        // 修改元素处理逻辑
        allTextElements.forEach(element => {
            // 跳过计数器和对话框元素
            if (element.closest('.match-counter') ||
                element.closest('.keywords-dialog')) {
                return;
            }

            const elementPath = getXPath(element);
            // 检查此路径是否已处理过
            if (processedPaths.has(elementPath)) {
                return;
            }

            const content = getTextContent(element);
            if (content) {
                let hasMatch = false;
                keywords.forEach(keyword => {
                    if (!keyword) return;

                    const isNumber = /^\d+(\.\d+)?$/.test(keyword);
                    let regex;

                    if (isNumber) {
                        regex = createNumberRegex(keyword);
                    } else {
                        regex = new RegExp(
                            keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                            'gi'
                        );
                    }

                    const matches = content.match(regex);
                    if (matches) {
                        hasMatch = true;
                        matchCounts[keyword] += matches.length;
                        // 收集匹配元素
                        matchedElements[keyword].push({
                            element: element,
                            content: content
                        });
                    }
                });

                // 如果元素有匹配，标记该元素但不影响其他元素
                if (hasMatch) {
                    element.setAttribute('data-matched', 'true');
                }

                // 记录已处理的路径
                processedPaths.add(elementPath);
            }
        });

        // 修改 TreeWalker 的节点过滤
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    const parent = node.parentElement;
                    if (!parent ||
                        parent.nodeName === 'SCRIPT' ||
                        parent.nodeName === 'STYLE' ||
                        parent.closest('.match-counter') ||
                        parent.closest('.keywords-dialog') ||
                        parent.closest('[data-matched]')) { // 添加已匹配元素的检查
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        while (walker.nextNode()) {
            const text = walker.currentNode.textContent.trim();
            if (text) {
                keywords.forEach(keyword => {
                    if (!keyword) return;

                    const isNumber = /^\d+(\.\d+)?$/.test(keyword);
                    let regex;

                    if (isNumber) {
                        regex = createNumberRegex(keyword);
                    } else {
                        regex = new RegExp(
                            keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                            'gi'
                        );
                    }

                    const matches = text.match(regex);
                    if (matches) {
                        matchCounts[keyword] += matches.length;
                    }
                });
            }
        }

        // 生成显示内容
        const matchedKeywords = keywords.filter(keyword => matchCounts[keyword] > 0);

        let newContent;
        if (matchedKeywords.length > 0) {
            newContent = matchedKeywords
                .map(keyword => `
                    <span>
                        <span class="keyword" data-keyword="${keyword}">${keyword}</span>：
                        出现 <span class="count">${matchCounts[keyword]}</span> 次
                    </span>
                `)
                .join('；<br>');

            // 使用事件委托处理关键词点击
            counter.addEventListener('click', (event) => {
                const keywordElement = event.target.closest('.keyword');
                if (keywordElement) {
                    event.stopPropagation(); // 阻止冒泡，防止触发文档点击事件
                    const keyword = keywordElement.getAttribute('data-keyword');
                    findAndHighlight(keyword);
                }
            });
        } else {
            newContent = '未匹配到关键词';
        }

        // 更新DOM并保存最新匹配结果
        if (counter.innerHTML !== newContent) {
            counter.innerHTML = newContent;
            latestMatchResults = matchedElements;
        }
    }

    // 修改 findAndHighlight 函数
    function findAndHighlight(keyword) {
        // 如果是新关键词，重置搜索状态
        if (currentSearchState.keyword !== keyword) {
            currentSearchState.keyword = keyword;
            currentSearchState.matches = [];
            currentSearchState.currentIndex = -1;

            // 移除之前的高亮
            document.querySelectorAll('.highlight-match').forEach(el => {
                el.classList.remove('highlight-match');
            });

            // 收集所有匹配的元素
            if (latestMatchResults && latestMatchResults[keyword]) {
                currentSearchState.matches = latestMatchResults[keyword].map(match => match.element);
            }
        }

        // 移动到下一个匹配项
        currentSearchState.currentIndex++;
        if (currentSearchState.currentIndex >= currentSearchState.matches.length) {
            currentSearchState.currentIndex = 0;
        }

        // 获取当前匹配元素
        const currentMatch = currentSearchState.matches[currentSearchState.currentIndex];
        if (currentMatch) {
            // 移除之前的高亮和定时器
            document.querySelectorAll('.highlight-match').forEach(el => {
                el.classList.remove('highlight-match');
                // 获取可能存在的旧定时器ID并清除
                const timerId = el.getAttribute('data-highlight-timer');
                if (timerId) {
                    clearTimeout(parseInt(timerId));
                    el.removeAttribute('data-highlight-timer');
                }
            });

            // 判断是否是表单元素并添加高亮
            if (currentMatch instanceof HTMLInputElement ||
                currentMatch instanceof HTMLTextAreaElement ||
                currentMatch.hasAttribute('contenteditable') ||
                currentMatch.hasAttribute('nz-input') ||
                currentMatch.classList.contains('ant-input')) {
                currentMatch.classList.add('highlight-match');
            } else {
                currentMatch.classList.add('highlight-match');
            }

            // 滚动到可见位置
            currentMatch.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

            // 设置新的定时器并保存ID
            const timerId = setTimeout(() => {
                currentMatch.classList.remove('highlight-match');
                currentMatch.removeAttribute('data-highlight-timer');
            }, 3000);

            // 保存定时器ID
            currentMatch.setAttribute('data-highlight-timer', timerId.toString());
        }
    }

    // 添加全局变量用于跟踪当前搜索状态
    let currentSearchState = {
        keyword: null,
        matches: [],
        currentIndex: -1
    };

    // 添加域名配置相关函数
    function saveDomains(includeList, excludeList) {
        GM_setValue(CONFIG.STORAGE_KEYS.INCLUDE_DOMAINS, includeList);
        GM_setValue(CONFIG.STORAGE_KEYS.EXCLUDE_DOMAINS, excludeList);
    }

    function getDomains() {
        return {
            include: GM_getValue(CONFIG.STORAGE_KEYS.INCLUDE_DOMAINS, []),
            exclude: GM_getValue(CONFIG.STORAGE_KEYS.EXCLUDE_DOMAINS, [])
        };
    }

    function createDomainDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
        `;

        const dialog = document.createElement('div');
        dialog.className = 'keywords-dialog';

        const domains = getDomains();

        dialog.innerHTML = `
            <h3>网站匹配设置</h3>
            <div style="margin: 10px 0">
                <label>启用的域名（每行一个）：</label>
                <textarea class="keywords-textarea" id="include-domains"
                    placeholder="example.com">${domains.include.join('\n')}</textarea>
            </div>
            <div style="margin: 10px 0">
                <label>排除的域名（每行一个）：</label>
                <textarea class="keywords-textarea" id="exclude-domains"
                    placeholder="example.com">${domains.exclude.join('\n')}</textarea>
            </div>
            <div style="text-align: right">
                <button class="cancel-btn">取消</button>
                <button class="save-btn">保存</button>
            </div>
        `;

        const closeDialog = () => {
            document.body.removeChild(overlay);
            document.body.removeChild(dialog);
        };

        dialog.querySelector('.cancel-btn').addEventListener('click', closeDialog);

        dialog.querySelector('.save-btn').addEventListener('click', () => {
            const includeDomains = dialog.querySelector('#include-domains').value
                .split('\n')
                .map(d => d.trim())
                .filter(Boolean);

            const excludeDomains = dialog.querySelector('#exclude-domains').value
                .split('\n')
                .map(d => d.trim())
                .filter(Boolean);

            saveDomains(includeDomains, excludeDomains);
            closeDialog();
            checkAndInit(); // 重新检查并初始化
        });

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
    }

    // 优化域名检查函数
    function shouldRunOnDomain() {
        const { include, exclude } = getDomains();
        const currentDomain = window.location.hostname;

        // 没有任何限制时允许运行
        if (!include.length && !exclude.length) return true;

        // 在排除列表中则不运行
        if (exclude.some(domain =>
            currentDomain === domain ||
            currentDomain.endsWith('.' + domain)
        )) return false;

        // 有包含列表时必须匹配
        return !include.length || include.some(domain =>
            currentDomain === domain ||
            currentDomain.endsWith('.' + domain)
        );
    }

    // 修改启动逻辑相关函数
    function init() {
        const debouncedUpdate = debounce(updateCounter, 300);

        // 定义可交互元素选择器
        const interactiveSelectors = [
            'button',
            'a',
            '[role="button"]',
            '[role="tab"]',
            '[role="menuitem"]',
            '[role="option"]',
            '.ant-btn',
            '.ant-switch'
        ].join(',');

        // 使用事件委托监听点击事件
        document.addEventListener('click', (event) => {
            if (event.target.closest('.match-counter')) {
                return;
            }

            const target = event.target;
            const interactiveElement = target.matches(interactiveSelectors) ?
                target : target.closest(interactiveSelectors);

            if (interactiveElement) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        debouncedUpdate();
                    });
                });
            }
        }, { passive: true });

        // 保留表单输入事件监听
        document.body.addEventListener('input', (event) => {
            const target = event.target;
            if ((target instanceof HTMLInputElement ||
                 target instanceof HTMLTextAreaElement) &&
                !target.closest('.match-counter')) {
                debouncedUpdate();
            }
        }, { passive: true });

        // 直接执行一次更新，不使用防抖
        updateCounter();
    }

    function checkAndInit() {
        if (!shouldRunOnDomain()) return;

        const menuCommands = {
            '⚙️ 设置关键词': createKeywordsDialog,
            '🌐 配置网站': createDomainDialog,
            '📥 导出匹配结果': exportMatchedElements
        };

        Object.entries(menuCommands).forEach(([title, handler]) => {
            GM_registerMenuCommand(title, handler);
        });

        // 修改初始化逻辑
        function initAndUpdate() {
            init();

            // 监听动态内容变化
            const observer = new MutationObserver(debounce(() => {
                updateCounter();
            }, 1000));

            // 观察 document.body 的子树变化
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }

        // 分阶段执行初始化
        if (document.readyState === 'complete') {
            // 页面已完全加载
            setTimeout(initAndUpdate, 1000);
        } else {
            // 等待 DOM 加载完成
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(initAndUpdate, 500);
            });

            // 等待页面完全加载
            window.addEventListener('load', () => {
                setTimeout(initAndUpdate, 1000);
            });

            // 额外等待动态内容
            setTimeout(initAndUpdate, 2000);
        }
    }

    // 修改启动脚本逻辑
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAndInit);
    } else {
        checkAndInit();
    }

})();
