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

// 在文件顶部的常量定义区域后添加

// HTML转义函数
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 添加一个用于存储最新匹配结果的全局变量
let latestMatchResults = null;

// 在顶层添加 createNumberRegex 函数
function createNumberRegex(number) {
    // 处理数字前后可能出现的字符类型
    return new RegExp(
        // (?<!) 和 (?<=[^]) 是零宽负向后发断言
        // (?!) 和 (?=[^]) 是零宽负向前发断言
        `(?<!\\d)(?<!\\.)${number}(?!\\d)(?!\\.)`,
        'g'
    );
}

// 添加一个新的辅助函数来处理重叠匹配
function mergeOverlappingMatches(matches) {
    // 按起始位置排序所有匹配
    const sortedMatches = matches.sort((a, b) => a.index - b.index);
    const mergedMatches = [];
    let currentMatch = null;

    for (const match of sortedMatches) {
        if (!currentMatch) {
            currentMatch = { ...match };
        } else {
            // 检查是否重叠
            if (match.index <= currentMatch.index + currentMatch.text.length) {
                // 合并重叠部分
                const endIndex = Math.max(
                    currentMatch.index + currentMatch.text.length,
                    match.index + match.text.length
                );
                currentMatch.text = match.text.substring(0, endIndex - match.index);
                currentMatch.colorClasses = currentMatch.colorClasses || [];
                currentMatch.colorClasses.push(match.colorClass);
            } else {
                // 没有重叠，保存当前匹配并开始新的匹配
                mergedMatches.push(currentMatch);
                currentMatch = { ...match };
            }
        }
    }

    if (currentMatch) {
        mergedMatches.push(currentMatch);
    }

    return mergedMatches;
}

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

        .match-trigger {
            position: fixed !important;
            right: 2vh !important;
            bottom: 2vh !important;
            width: 6vh !important;
            height: 6vh !important;
            border-radius: 50% !important;
            background: rgba(255, 255, 0, 0.8) !important;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
            cursor: pointer !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 14px !important;
            line-height: 1.5 !important;
            text-align: center !important;
            z-index: 2147483647 !important;
            transition: transform 0.3s ease !important;
        }

        .match-trigger:hover {
            transform: scale(1.1) !important;
        }

        .match-results {
            position: fixed !important;
            right: 20px !important;
            bottom: calc(10vh + 20px) !important;
            min-width: 200px !important;
            max-width: 80vw !important;
            padding: 10px 15px !important;
            border-radius: 6px !important;
            background: rgba(255, 255, 0, 0.8) !important;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2) !important;
            z-index: 2147483646 !important;
            font-size: 16px !important;
            line-height: 1.5 !important;
            max-height: 70vh !important;
            overflow-y: auto !important;
            display: none; /* 移除 !important */
        }

        .match-results .match-item {
            margin: 5px 0 !important;
            padding: 5px !important;
            border-bottom: 1px solid rgba(0,0,0,0.1) !important;
        }

        .match-results .match-item:last-child {
            border-bottom: none !important;
        }

        .match-results .keyword {
            color: #0066cc !important;
            cursor: pointer !important;
            text-decoration: underline !important;
        }

        .match-results .count {
            color: #ff0000 !important;
            font-weight: bold !important;
        }

        mark {
            background-color: #ffecb3 !important;
            padding: 2px 4px !important;
            border-radius: 2px !important;
            display: inline-block !important;
            transition: all 0.3s ease !important;
        }
        mark:hover {
            transform: scale(1.02) !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
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
        highlightCache.clear(); // 清除缓存
    }

    function getKeywords() {
        return GM_getValue('highlightKeywords', []);
    }

    // 修改创建关键词设置对话框函数
    function createKeywordsDialog() {
        const overlay = document.createElement('div');
        overlay.setAttribute('data-script-element', 'true');
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
        dialog.setAttribute('data-script-element', 'true');

        // 创建取消函数
        const closeDialog = () => {
            document.body.removeChild(overlay);
            document.body.removeChild(dialog);
            // 移除全局函数
            delete window.saveAndClose;
        };

        dialog.innerHTML = `
            <h3>设置关键词</h3>
            <div style="margin-bottom: 10px; font-size: 12px; color: #666;">
                <p>支持以下格式：</p>
                <ul style="margin: 5px 0; padding-left: 20px;">
                    <li>普通文本：直接输入要匹配的文字</li>
                    <li>数字：输入纯数字将精确匹配</li>
                </ul>
                <p>每行输入一个关键词</p>
            </div>
            <textarea class="keywords-textarea" placeholder="请输入关键词，每行一个
示例：
关键词1
123
关键词2">${getKeywords().join('\n')}</textarea>
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

    // 优化 debounce 函数
    function debounce(func, wait, immediate = false) {
        let timeout;
        return function(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(this, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(this, args);
        };
    }

    // 添加一个新函数用于提取正则表达式匹配的内容
    function extractMatches(content, keyword) {
        let matches = [];

        // 检查是否是数字
        const isNumber = /^\d+(\.\d+)?$/.test(keyword);
        if (isNumber) {
            // 使用数字精确匹配
            const regex = createNumberRegex(keyword);
            let match;
            while ((match = regex.exec(content)) !== null) {
                matches.push({
                    text: match[0],
                    index: match.index
                });
            }
        } else {
            // 普通文本匹配
            let index = 0;
            let searchText = content;
            while ((index = searchText.indexOf(keyword, index)) > -1) {
                matches.push({
                    text: keyword,
                    index: index
                });
                index += keyword.length;
            }
        }

        return matches;
    }

    // 修改 exportMatchedElements 函数，增加匹配内容高亮功能
    function exportMatchedElements() {
        try {
            if (!latestMatchResults || Object.keys(latestMatchResults).length === 0) {
                alert('当前没有匹配结果可导出');
                return;
            }

            // 显示进度提示
            const progressDiv = document.createElement('div');
            progressDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                z-index: 10000;
                text-align: center;
            `;
            progressDiv.innerHTML = '正在处理数据: 0%';
            document.body.appendChild(progressDiv);

            // 分批处理数据
            const processNextBatch = async () => {
                // 创建元素到关键词的映射
                const elementMap = new Map();

                // 收集每个元素的所有关键词匹配
                for (const [keyword, elements] of Object.entries(latestMatchResults)) {
                    elements.forEach(elem => {
                        const key = elem.element;
                        if (!elementMap.has(key)) {
                            elementMap.set(key, {
                                content: elem.content,
                                keywords: new Map(),
                                element: elem.element
                            });
                        }
                        elementMap.get(key).keywords.set(keyword, elem.matches);
                    });
                }

                const batchSize = 50;
                let content = [];

                content.push(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>关键词匹配结果导出</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .element-section { margin-bottom: 30px; background: #fff; border: 1px solid #eee; border-radius: 8px; }
        .element-header { background: #f8f9fa; padding: 15px; border-bottom: 1px solid #eee; border-radius: 8px 8px 0 0; }
        .match-content {
            background: #fff;
            padding: 15px;
            margin: 0;
            word-break: break-word;
            line-height: 1.6;
        }
        .keywords-list {
            margin: 10px 0;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
        }
        .keyword-item {
            display: inline-block;
            margin: 2px 5px;
            padding: 2px 8px;
            background: #e9ecef;
            border-radius: 12px;
            font-size: 14px;
        }
        mark {
            background-color: #fff3cd;
            padding: 0 2px;
            border-radius: 2px;
            display: inline-block;
        }
        mark.keyword-1 { background-color: #ffecb3; }
        mark.keyword-2 { background-color: #b3e5fc; }
        mark.keyword-3 { background-color: #c8e6c9; }
        mark.keyword-4 { background-color: #f8bbd0; }
        mark.keyword-5 { background-color: #d1c4e9; }
    </style>
</head>
<body>
    <h1>关键词匹配结果导出</h1>
    <p>导出时间: ${new Date().toLocaleString()}</p>`);

                let processedCount = 0;
                const totalElements = elementMap.size;

                // 处理每个元素
                for (const [element, data] of elementMap) {
                    const highlightedContent = processHighlights(data.content, data.keywords);
                    const keywordsList = Array.from(data.keywords.entries()).map(([keyword, matches]) => `
                        <span class="keyword-item">${escapeHtml(keyword)} (${matches.length}次)</span>
                    `);

                    content.push(`
                        <div class="element-section">
                            <div class="element-header">
                                <h3>元素信息</h3>
                                <p>类型: ${escapeHtml(data.element.tagName.toLowerCase())}</p>
                                ${data.element.type ? '<p>输入类型: ' + escapeHtml(data.element.type) + '</p>' : ''}
                                ${data.element.className ? '<p>类名: ' + escapeHtml(data.element.className) + '</p>' : ''}
                                ${data.element.id ? '<p>ID: ' + escapeHtml(data.element.id) + '</p>' : ''}
                                <div class="keywords-list">
                                    <strong>匹配的关键词：</strong>
                                    ${keywordsList.join('')}
                                </div>
                            </div>
                            <div class="match-content">${highlightedContent}</div>
                        </div>
                    `);

                    processedCount++;
                    if (processedCount % batchSize === 0) {
                        const progress = Math.round((processedCount / totalElements) * 100);
                        progressDiv.innerHTML = `正在处理数据: ${progress}%`;
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }

                content.push('</body></html>');

                // 创建并下载文件
                const blob = new Blob([content.join('\n')], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `关键词匹配结果_${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
                document.body.appendChild(a);
                a.click();

                // 清理
                setTimeout(() => {
                    document.body.removeChild(progressDiv);
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
            };

            // 开始处理
            processNextBatch().catch(error => {
                console.error('导出过程中发生错误:', error);
                alert('导出过程中发生错误，请查看控制台获取详细信息');
                document.body.removeChild(progressDiv);
            });

        } catch (error) {
            console.error('导出过程中发生错误:', error);
            alert('导出过程中发生错误，请查看控制台获取详细信息');
        }
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

    // 在 createNumberRegex 函数后添加新的正则表达式验证函数
    function isValidRegExp(pattern) {
        try {
            new RegExp(pattern);
            return true;
        } catch (e) {
            return false;
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
        // 创建圆形触发器
        const trigger = document.createElement('div');
        trigger.className = 'match-trigger';
        trigger.setAttribute('data-script-element', 'true');
        trigger.innerHTML = '查看<br>关键词'; // 初始文本
        document.body.appendChild(trigger);

        // 创建结果显示区域（初始隐藏）
        const results = document.createElement('div');
        results.className = 'match-results';
        results.setAttribute('data-script-element', 'true');
        document.body.appendChild(results);

        // 点击触发器的处理函数
        trigger.addEventListener('click', async () => {
            if (isResultsVisible) {
                // 隐藏结果
                results.style.display = 'none';
                trigger.innerHTML = '查看<br>关键词';
                isResultsVisible = false;
            } else {
                // 强制刷新匹配结果缓存
                matchResultsCache = null;
                highlightCache.clear();

                // 执行新的匹配
                await executeMatch();

                // 更新并显示结果
                await updateMatchResults();

                // 设置结果浮层样式
                results.style.cssText = `
                    display: block;
                    position: fixed;
                    right: 20px;
                    bottom: calc(12vh + 20px);
                    min-width: 200px;
                    max-width: 80vw;
                    padding: 10px 15px;
                    border-radius: 6px;
                    background: rgba(255, 255, 255, 0.95);
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                    z-index: 2147483646;
                    font-size: 16px;
                    line-height: 1.5;
                    max-height: 70vh;
                    overflow-y: auto;
                `;
                trigger.innerHTML = '隐藏<br>关键词';
                isResultsVisible = true;
            }
        });

        // 添加 MutationObserver 监听页面变化
        const observer = new MutationObserver(debounce(() => {
            if (isResultsVisible) {
                // 清除缓存以强制重新匹配
                matchResultsCache = null;
                updateMatchResults();
            }
        }, 1000));

        // 配置 observer
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // 保存 observer 引用以便需要时清理
        window._keywordMatchObserver = observer;
    }

    // 添加更新匹配结果的函数
    async function updateMatchResults() {
        const results = document.querySelector('.match-results');
        if (!results) return;

        try {
            results.removeEventListener('click', handleKeywordClick);

            if (!matchResultsCache) {
                await executeMatch();
            }

            if (!matchResultsCache) {
                results.innerHTML = '未找到匹配结果';
                return;
            }

            const matchedResults = [];
            for (const [keyword, elements] of Object.entries(matchResultsCache)) {
                if (elements.length > 0) {
                    matchedResults.push(`
                        <div class="match-item">
                            <span class="keyword" data-keyword="${escapeHtml(keyword)}">${escapeHtml(keyword)}</span>：
                            出现 <span class="count">${elements.length}</span> 次
                        </div>
                    `);
                }
            }

            results.innerHTML = matchedResults.length > 0 ?
                matchedResults.join('') :
            '未找到匹配结果';

            results.addEventListener('click', handleKeywordClick);
            results.style.display = 'block';
        } catch (error) {
            console.error('更新匹配结果时发生错误:', error);
            results.innerHTML = '更新匹配结果时发生错误';
        }
    }

    // 添加关键词点击事件处理函数
    function handleKeywordClick(event) {
        const keywordElement = event.target.closest('.keyword');
        if (keywordElement) {
            event.stopPropagation();
            const keyword = keywordElement.getAttribute('data-keyword');
            findAndHighlight(keyword);
        }
    }

    // 在 executeMatch 函数前添加 updateCounter 函数
    function updateCounter() {
        const keywords = getKeywords();
        if (!keywords || keywords.length === 0) {
            latestMatchResults = null;
            return;
        }

        // 创建结果对象
        const results = {};

        // 获取所有可能包含文本的元素，但排除脚本创建的浮层
        const selectors = [
            FORM_SELECTORS.inputs,
            FORM_SELECTORS.textAreas,
            FORM_SELECTORS.contentEditable,
            FORM_SELECTORS.textContainers,
            FORM_SELECTORS.angularInputs
        ].join(',');

        // 获取元素时排除脚本创建的浮层
        const excludeSelectors = [
            '[data-script-element="true"]',
            '[data-highlight-timer]'
        ].join(',');

        // 使用:not选择器排除脚本创建的元素
        const elements = document.querySelectorAll(
            `${selectors}:not(${excludeSelectors}):not(${excludeSelectors} *)`
        );

        // 遍历所有元素
        elements.forEach(element => {
            // 检查元素是否在脚本创建的浮层内
            const isInScriptElement = element.closest('.keywords-dialog, .match-trigger, .match-results');
            if (isInScriptElement) return;

            const content = getTextContent(element);
            if (!content) return;

            // 遍历所有关键词
            keywords.forEach(keyword => {
                if (!keyword) return;

                // 使用 extractMatches 获取匹配
                const matches = extractMatches(content, keyword);
                if (matches.length > 0) {
                    if (!results[keyword]) {
                        results[keyword] = [];
                    }
                    results[keyword].push({
                        element,
                        content,
                        matches
                    });
                }
            });
        });

        // 更新全局匹配结果
        latestMatchResults = results;
    }

    // 执行匹配的函数
    async function executeMatch() {
        try {
            // 执行匹配逻辑
            updateCounter();

            // 将匹配结果保存到缓存
            matchResultsCache = latestMatchResults;

            // 如果没有找到匹配结果，返回 null
            if (!matchResultsCache || Object.keys(matchResultsCache).length === 0) {
                matchResultsCache = null;
                return null;
            }

            return matchResultsCache;
        } catch (error) {
            console.error('执行匹配时发生错误:', error);
            matchResultsCache = null;
            return null;
        }
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

        // 直接初始化，不需要分阶段
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    // 修改启动脚本逻辑
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAndInit);
    } else {
        checkAndInit();
    }

    // 添加缓存变量
    let matchResultsCache = null;
    let isResultsVisible = false;

    matchResultsCache = null;

    // 在 exportMatchedElements 函数之前添加这些函数
    function getColorForClass(colorClass) {
        const colors = {
            'keyword-1': '#ffecb3',
            'keyword-2': '#b3e5fc',
            'keyword-3': '#c8e6c9',
            'keyword-4': '#f8bbd0',
            'keyword-5': '#d1c4e9'
        };
        return colors[colorClass] || '#fff3cd';
    }

    // 在 IIFE 顶部添加缓存变量
    const highlightCache = new Map();

    // 在 processHighlights 函数内添加缓存机制
    function processHighlights(content, keywordsMap) {
        // 添加缓存逻辑
        const cacheKey = content + Array.from(keywordsMap.keys()).join(',');
        if (highlightCache.has(cacheKey)) {
            return highlightCache.get(cacheKey);
        }

        let highlightedContent = escapeHtml(content);

        // 按关键词长度降序排序，确保长的关键词优先匹配
        const sortedKeywords = Array.from(keywordsMap.keys())
        .sort((a, b) => b.length - a.length);

        sortedKeywords.forEach((keyword, index) => {
            const colorClass = `keyword-${(index % 5) + 1}`;
            const matches = extractMatches(content, keyword);

            // 从后向前替换以避免位置偏移
            matches.sort((a, b) => b.index - a.index).forEach(match => {
                const escapedMatch = escapeHtml(match.text);
                const before = highlightedContent.substring(0, match.index);
                const after = highlightedContent.substring(match.index + match.text.length);
                highlightedContent = `${before}<mark class="${colorClass}">${escapedMatch}</mark>${after}`;
            });
        });

        highlightCache.set(cacheKey, highlightedContent);
        return highlightedContent;
    }

})()
