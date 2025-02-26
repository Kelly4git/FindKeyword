// ==UserScript==
// @name         网页关键词匹配计数工具
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
    ].join(',')
};

// 在 FORM_SELECTORS 常量后添加新的配置常量
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
            bottom: 2vh !important;
            padding: 10px 15px !important;
            border-radius: 6px !重要;
            z-index: 2147483647 !important;
            font-size: 14px !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
            line-height: 1.5 !important;
            white-space: nowrap !important;
            max-height: 70vh !important;
            overflow-y: auto !important;
            overflow-x: hidden !重要;
            pointer-events: auto !important; /* 允许点击 */
            background: rgba(255, 255, 0, 0.5) !important;
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
            margin-top: 8px !重要;
            width: 100% !重要;
        }
        .export-btn:hover {
            background: #45a049 !重要;
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
                FORM_SELECTORS.textContainers
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

        // 修改元素处理逻辑
        allTextElements.forEach(element => {
            // 跳过计数器和对话框元素
            if (element.closest('.match-counter') ||
                element.closest('.keywords-dialog')) {
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

                // 如果元素有匹配，标记该元素已匹配
                if (hasMatch) {
                    element.setAttribute('data-matched', 'true');
                }
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
            // 只显示匹配次数，移除导出按钮
            newContent = matchedKeywords
                .map(keyword => `${keyword}：出现 <span class="count">${matchCounts[keyword]}</span> 次`)
                .join('；<br>');
        } else {
            // 没有匹配时显示提示文本
            newContent = '未匹配到关键词';
        }

        // 更新DOM并保存最新匹配结果
        if (counter.innerHTML !== newContent) {
            counter.innerHTML = newContent;
            latestMatchResults = matchedElements;
        }
    }

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

    // 添加域名匹配检查函数
    function shouldRunOnDomain() {
        const domains = getDomains();
        const currentDomain = window.location.hostname;

        // 如果没有设置任何域名，则在所有网站运行
        if (!domains.include.length && !domains.exclude.length) {
            return true;
        }

        // 检查是否在排除列表中
        if (domains.exclude.some(domain =>
            currentDomain === domain ||
            currentDomain.endsWith('.' + domain)
        )) {
            return false;
        }

        // 如果有包含列表，检查是否匹配
        if (domains.include.length) {
            return domains.include.some(domain =>
                currentDomain === domain ||
                currentDomain.endsWith('.' + domain)
            );
        }

        return true;
    }

    // 初始化
    function init() {
        // 注册菜单命令
        GM_registerMenuCommand('⚙️ 设置关键词', createKeywordsDialog);
        GM_registerMenuCommand('🌐 配置网站', createDomainDialog);
        GM_registerMenuCommand('📥 导出匹配结果', exportMatchedElements);

        // 确保初始化时就创建计数器
        updateCounter();

        // 监听表单变化
        const debouncedUpdate = debounce(updateCounter, 300);
        const observer = new MutationObserver((mutations) => {
            // 只在实际内容变化时更新
            const shouldUpdate = mutations.some(mutation => {
                // 仅当文本内容直接变化时
                if (mutation.type === 'characterData') {
                    return true;
                }

                // 仅当新增或删除了文本节点时
                if (mutation.type === 'childList') {
                    return [...mutation.addedNodes, ...mutation.removedNodes].some(
                        node => node.nodeType === Node.TEXT_NODE
                    );
                }

                // 仅当表单值变化时
                if (mutation.type === 'attributes') {
                    if (mutation.attributeName === 'value') {
                        const target = mutation.target;
                        if (target instanceof HTMLInputElement ||
                            target instanceof HTMLTextAreaElement) {
                            // 比较旧值和新值
                            return target.value !== target._lastValue;
                        }
                    }
                }

                return false;
            });

            if (shouldUpdate) {
                // 更新前保存当前表单值
                mutations.forEach(mutation => {
                    if (mutation.type === 'attributes' &&
                        mutation.attributeName === 'value') {
                        const target = mutation.target;
                        if (target instanceof HTMLInputElement ||
                            target instanceof HTMLTextAreaElement) {
                            target._lastValue = target.value;
                        }
                    }
                });

                debouncedUpdate();
            }
        });

        // 修改观察配置,移除样式相关监听
        observer.observe(document.body, {
            childList: true,       // 监听节点添加/删除
            subtree: true,        // 监听所有后代节点
            characterData: true,   // 监听文本内容变化
            attributes: true,      // 监听属性变化
            attributeFilter: ['value', 'textContent', 'innerText'], // 添加更多属性监听
            characterDataOldValue: true // 保存文本变化的旧值
        });

        // 添加输入事件监听
        document.addEventListener('input', (event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement) {
                debouncedUpdate();
            }
        });
    }

    // 修改初始化检查函数
    function checkAndInit() {
        if (shouldRunOnDomain()) {
            init();
        }
    }

    // 启动脚本
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAndInit);
    } else {
        checkAndInit();
    }

})();
