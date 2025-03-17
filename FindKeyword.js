// ==UserScript==
// @name         网页关键词查询工具普通版
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  统计表单中关键词的匹配次数
// @author       Your name
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        window.onurlchange
// @grant        window.focus
// @grant        window.onblur
// ==/UserScript==

(function() { // 将所有代码包裹在IIFE中
    'use strict';

    // 在脚本顶部添加
    let currentDialog = null; // 现在在IIFE作用域内

    // HTML转义函数
    const escapeHtml = (function() {
        return function(unsafe) {
            if (unsafe == null) return ''; // 仅处理 null/undefined
            return String(unsafe)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        };
    })();

    // 缓存必须在所有函数之前声明
    const highlightCache = new Map();
    let latestMatchResults = null;
    let matchResultsCache = null;
    let isResultsVisible = false;

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

    // 在顶层添加 createNumberRegex 函数
    function createLetterRegex(letter) {
        // 处理数字前后可能出现的字符类型
        return new RegExp(
            // (?<!) 和 (?<=[^]) 是零宽负向后发断言
            // (?!) 和 (?=[^]) 是零宽负向前发断言
            `(?<!\\S)${letter}(?!\\S)`,//单词边界没有任何字符
            'gu' // 全局匹配+不忽略大小写+Unicode字符支持
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

    // 在脚本顶部添加全局状态标记
    let isActiveTab = document.visibilityState === 'visible';
    let isInitialized = false;
    let isDialogOpen = false;

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
            // 增加排除逻辑：禁止 div 直系子元素的 nz-form-label
            'nz-form-label:not(div nz-form-label)'  /* 空格表示任意层级嵌套 */
        ].join(',')
    };

    // 将配置常量合并和简化
    const CONFIG = {
        STORAGE_KEYS: {
            INCLUDE_DOMAINS: 'ks_includeDomains',
            EXCLUDE_DOMAINS: 'ks_excludeDomains',
            EXACT_KEYWORDS: 'exactKeywords',  // 新增
            FUZZY_KEYWORDS: 'fuzzyKeywords'   // 新增
        }
    };

    // 修改样式定义,添加导出按钮样式
    GM_addStyle(`
        .ks-keywords-dialog {
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
        .ks-highlight-match {
            background-color: #ffeb3b;
            outline: 2px solid #ffc107;
        }
         /* 添加过渡效果 */
        .ks-highlight-match {
            transition: background-color 0.3s ease-out, outline 0.3s ease-out;
        }
        /* 表单元素高亮样式 */
        input.ks-highlight-match,
        textarea.ks-highlight-match,
        [contenteditable].ks-highlight-match,
        [nz-input].ks-highlight-match,
        .ant-input.ks-highlight-match {
            background-color: #fff3cd !important;
            border-color: #ffc107 !important;
            box-shadow: 0 0 0 0.2rem rgba(255, 193, 7, 0.25) !important;
            outline: none !important;
            transition: all 0.3s ease-out !important;
        }

        /* 普通元素高亮样式保持不变 */
        .ks-highlight-match:not(input):not(textarea):not([contenteditable]):not([nz-input]):not(.ant-input) {
            background-color: #ffeb3b !important;
            outline: 2px solid #ffc107 !important;
        }

        .ks-match-trigger {
            position: fixed !important;
            right: 2vh !important;
            bottom: 2vh !important;
            width: 8vh !important;
            height: 8vh !important;
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

        .ks-match-trigger:hover {
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

    function handleVisibilityChange() {
        if (isDialogOpen) return; // 新增对话框状态判断
        isActiveTab = document.visibilityState === 'visible';
        toggleScriptState();
    }


    function handleWindowBlur() {
        if (isDialogOpen) return; // 新增对话框状态判断
        isActiveTab = false;
        toggleScriptState();
    }
    
    function handleWindowFocus() {
        if (isDialogOpen) return; // 新增对话框状态判断
        isActiveTab = true;
        toggleScriptState();
    }
    
    function toggleScriptState() {
        if (isDialogOpen) return; // 新增：对话框打开时阻止状态切换

        if (isActiveTab) {
            if (!isInitialized) {
                checkAndInit();
                isInitialized = true;
            }
        } else {
            cleanupScript();
            isInitialized = false;
        }
    }
    
    // 新增清理函数
    function cleanupScript() {
        // 移除事件监听
        document.removeEventListener('visibilitychange', boundHandlers.vis);
        window.removeEventListener('blur', boundHandlers.blur);
        window.removeEventListener('focus', boundHandlers.focus);
  
        // 移除事件监听
        if (window._keywordMatchObserver) {
            window._keywordMatchObserver.disconnect();
            window._keywordMatchObserver = null; // ⭐ 置空而非 delete
        }

        if (isDialogOpen) return; // 防止清理时误删对话框
        // 移除所有脚本创建的DOM元素
        //document.querySelectorAll('[data-ks-element]').forEach(el => el.remove());
        document.querySelectorAll('[data-ks-element]').forEach(el => el.remove());
        
        // 移除全局样式
        const style = document.getElementById('tampermonkey-style');
        if (style) style.remove();
        
        // 清除缓存
        highlightCache.clear();
        matchResultsCache = null;

    }

    // 修改清理文本函数，只清理不可见字符
    function cleanText(text) {
        return text
        // 清理所有空白字符（空格、制表符、换页符、换行符等）
            .replace(/[\s\uFEFF\xA0]+/g, '')
            .trim();
    }

    // 关键词存储相关函数
    function saveKeywords(exactKeywords, fuzzyKeywords) {
        GM_setValue(CONFIG.STORAGE_KEYS.EXACT_KEYWORDS, exactKeywords);
        GM_setValue(CONFIG.STORAGE_KEYS.FUZZY_KEYWORDS, fuzzyKeywords);
        highlightCache.clear();
    }
    
    function getKeywords() {
        return {
            exact: GM_getValue(CONFIG.STORAGE_KEYS.EXACT_KEYWORDS, []),
            fuzzy: GM_getValue(CONFIG.STORAGE_KEYS.FUZZY_KEYWORDS, [])
        };
    }

    // 修改创建关键词设置对话框函数
    function createKeywordsDialog() {
        // 在创建新对话框前清理旧元素
        const existingDialogs = document.querySelectorAll('.ks-keywords-dialog, [data-ks-element="overlay"]');
        existingDialogs.forEach(el => el.remove());

        isDialogOpen = true; // 新增状态标记
        let isClosing = false; // 新增关闭状态标记

        const overlay = document.createElement('div');
        overlay.setAttribute('data-ks-element', 'overlay');
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
        dialog.className = 'ks-keywords-dialog';
        dialog.setAttribute('data-ks-element', 'dialog');

        // 创建取消函数
        const closeDialog = () => {
            if (isClosing) return;
            isClosing = true;

            // 移除所有事件监听
            document.removeEventListener('keydown', handleEsc);
            overlay.removeEventListener('click', handleOverlayClick);

            // 移除元素
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            if (document.body.contains(dialog)) document.body.removeChild(dialog);

            isDialogOpen = false;
            isClosing = false;
            cleanupScript();
            checkAndInit();

            // 需要时重新初始化
            //if (saved) {
            //    cleanupScript();   // 清理旧元素和监听器    
            //    checkAndInit();    // 重新检查域名并初始化
            //}
        };

        dialog.innerHTML = `
        <h3>设置关键词</h3>
        <div style="margin-bottom: 10px; font-size: 12px; color: #666;">
            <p>支持以下格式：</p>
            <ul style="margin: 5px 0; padding-left: 20px;">
                <li>精确匹配：必须与文本内容完全一致</li>
                <li>模糊匹配：包含关键词且包含其他内容</li>
            </ul>
            <p>每行输入一个关键词</p>
        </div>
        <div>
            <label>精确匹配：</label>
            <textarea class="keywords-textarea" id="exact-keywords">${getKeywords().exact.join('\n')}</textarea>
        </div>
        <div>
            <label>模糊匹配：</label>
            <textarea class="keywords-textarea" id="fuzzy-keywords">${getKeywords().fuzzy.join('\n')}</textarea>
        </div>
        <div style="text-align: right">
            <button class="cancel-btn">取消</button>
            <button class="save-btn">保存</button>
        </div>
        `;

        dialog.querySelector('.save-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // 新增：阻止事件冒泡
            const exact = dialog.querySelector('#exact-keywords').value
                .split('\n').map(cleanText).filter(k => k.length > 0);
            const fuzzy = dialog.querySelector('#fuzzy-keywords').value
                .split('\n').map(cleanText).filter(k => k.length > 0);
            saveKeywords(exact, fuzzy);            
            closeDialog(); // 传递保存标记
        });

        // 修改取消按钮事件监听，阻止事件冒泡
        dialog.querySelector('.cancel-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // 新增：阻止事件冒泡            
            closeDialog(); // 传递保存标记
        });        

        // ESC处理函数
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation(); // 新增：阻止事件冒泡
                e.preventDefault(); // 阻止默认行为
                closeDialog(); // 传递保存标记                
            }
        };
        document.addEventListener('keydown', handleEsc, { once: true });

        // 遮罩层点击处理
        const handleOverlayClick = (e) => {
            if (e.target === overlay) {
                e.stopPropagation();
                closeDialog(); // 传递保存标记
            }
        };
        overlay.addEventListener('click', handleOverlayClick, { once: true });

        // 阻止对话框内容区域的点击冒泡
        dialog.addEventListener('click', (e) => {
            e.stopPropagation(); // 新增：阻止对话框内容区域的点击冒泡
        //    closeDialog(); // 传递保存标记
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

        // 检查是否是纯数字或单个字母
        const isNumberOrLetter = /^(?:\d+(?:\.\d+)?|[A-Za-z])$/.test(keyword);
        if (isNumberOrLetter) {
            let regex;

            // 修改2：分离数字和字母的匹配逻辑
            if (/^[A-Za-z]$/.test(keyword)) {
                // 新增字母边界处理[5,9](@ref)
                regex = createLetterRegex(keyword); // 单词边界+全局匹配+忽略大小写
            } else {
                // 使用数字精确匹配
                regex = createNumberRegex(keyword);
            }
            // 修改3：添加安全校验
            if (regex.global) {
                let match;
                while ((match = regex.exec(content)) !== null) {
                    matches.push({
                        text: match[0],
                        index: match.index
                    });
                }
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
    function exportMatchedElements(bypassCheck = false) {
        // 参数说明：
        // - bypassCheck: 布尔值，默认为 false
        //   true = 绕过激活状态检查
        //   false = 需要检查激活状态
        if (!bypassCheck && !isActiveTab) {
            alert('请切换到当前标签页再执行导出');
            return;
        }

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
                element.getAttribute('value') ||// 原生值
                element.value ||// 当前值
                element.textContent ||// 文本内容
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


    // 修改 findAndHighlight 函数
    function findAndHighlight(keyword) {
        if (!isActiveTab) return; // 后台不执行高亮
        // 如果是新关键词，重置搜索状态
        if (currentSearchState.keyword !== keyword) {
            currentSearchState.keyword = keyword;
            currentSearchState.matches = [];
            currentSearchState.currentIndex = -1;

            // 移除之前的高亮
            document.querySelectorAll('.ks-highlight-match').forEach(el => {
                el.classList.remove('ks-highlight-match');
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
            document.querySelectorAll('.ks-highlight-match').forEach(el => {
                el.classList.remove('ks-highlight-match');
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
                currentMatch.classList.add('ks-highlight-match');
            } else {
                currentMatch.classList.add('ks-highlight-match');
            }

            // 滚动到可见位置
            currentMatch.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

            // 设置新的定时器并保存ID
            const timerId = setTimeout(() => {
                currentMatch.classList.remove('ks-highlight-match');
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
    function saveDomains(include, exclude) {

        GM_setValue(CONFIG.STORAGE_KEYS.INCLUDE_DOMAINS, include);
        GM_setValue(CONFIG.STORAGE_KEYS.EXCLUDE_DOMAINS, exclude);    
        
        highlightCache.clear();
    }

    function getDomains() {
        return {
            //include: GM_getValue(CONFIG.STORAGE_KEYS.INCLUDE_DOMAINS, []),
            //exclude: GM_getValue(CONFIG.STORAGE_KEYS.EXCLUDE_DOMAINS, [])
            include: GM_getValue(CONFIG.STORAGE_KEYS.INCLUDE_DOMAINS, []),
            exclude: GM_getValue(CONFIG.STORAGE_KEYS.EXCLUDE_DOMAINS, [])
        };
    }

    function createDomainDialog() {
        // 在创建新对话框前清理旧元素
        const existingDialogs = document.querySelectorAll('.ks-keywords-dialog, [data-ks-element="overlay"]');
        existingDialogs.forEach(el => el.remove());

        isDialogOpen = true;
        let isClosing = false; // 关闭状态锁

        const overlay = document.createElement('div');
        overlay.setAttribute('data-ks-element', 'overlay');
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
        dialog.className = 'ks-keywords-dialog';
        dialog.setAttribute('data-ks-element', 'dialog');


        // 统一关闭处理函数
        const closeDialog = () => {
            if (isClosing) return;
            isClosing = true;

            // 移除所有事件监听
            document.removeEventListener('keydown', handleEsc);
            overlay.removeEventListener('click', handleOverlayClick);       
            
            // 安全移除元素
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
            if (document.body.contains(dialog)) document.body.removeChild(dialog);

            isDialogOpen = false;
            isClosing = false;
            cleanupScript();
            checkAndInit();

            // 需要时重新初始化
            //if (saved) {
            //    cleanupScript();
            //    checkAndInit();
            //}
        };
        
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

        // 保存按钮
        dialog.querySelector('.save-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const ks_includeDomains = dialog.querySelector('#include-domains').value
                .split('\n')
                .map(d => d.trim())
                .filter(Boolean);
            const ks_excludeDomains = dialog.querySelector('#exclude-domains').value
                .split('\n')
                .map(d => d.trim())
                .filter(Boolean);
            saveDomains(ks_includeDomains, ks_excludeDomains);
            closeDialog(); // 传递保存标记
        });
    
        // 取消按钮
        dialog.querySelector('.cancel-btn').addEventListener('click', (e) => {
            e.stopPropagation();            
            closeDialog(); // 传递保存标记
        });

        // ESC键处理
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                e.preventDefault();           
                closeDialog(true); // 传递保存标记
            }
        };
        document.addEventListener('keydown', handleEsc, { once: true });
    
        // 遮罩层点击处理
        const handleOverlayClick = (e) => {
            if (e.target === overlay) {
                e.stopPropagation();
                closeDialog();  // 传递保存标记
            }
        };
        overlay.addEventListener('click', handleOverlayClick, { once: true });
        
        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
    }        

    // 优化域名检查函数
    function shouldRunOnDomain() {
        // 从配置获取包含/排除域名列表（网页1中ASP.NET项目类似配置结构）
        const { include, exclude } = getDomains();
        // 获取当前访问的完整域名（如"www.example.com"）
        const currentDomain = window.location.hostname;

        // 当两个列表都为空时，允许在所有域名运行（网页1提到的无限制场景）
        if (!include.length && !exclude.length) return true;

        // 检查排除列表：当前域名精确匹配或属于排除域名的子域名（类似网页3的DNS记录检查逻辑）
        if (exclude.some(domain =>
            currentDomain === domain ||        // 精确匹配（如"example.com"）
            currentDomain.endsWith('.' + domain)// 子域名匹配（如"blog.example.com"）
        )) return false; // 匹配任意排除规则即拦截

        // 包含列表处理：当包含列表为空时放行，否则需匹配包含规则（网页2的域名有效性验证思路）
        return !include.length || 
            include.some(domain =>            // 遍历包含列表
                currentDomain === domain ||   // 精确匹配
                currentDomain.endsWith('.' + domain) // 子域名匹配
            );
    }

    // 修改启动逻辑相关函数
    function init() {
        if (isDialogOpen) return; // 防止初始化冲突

        // 先执行清理确保没有残留
        cleanupScript();

        // 创建圆形触发器
        const trigger = document.createElement('div');
        trigger.className = 'ks-match-trigger';
        trigger.setAttribute('data-ks-element', 'true');
        trigger.innerHTML = '查看<br>关键词'; // 初始文本

        document.body.appendChild(trigger);

        // 创建结果显示区域（初始隐藏）
        const results = document.createElement('div');
        results.className = 'match-results';
        results.setAttribute('data-ks-element', 'true');
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
        //keywordmatchObserver替换observer
        window._keywordMatchObserver = new MutationObserver(
            debounce(() => {
                if (isActiveTab && isResultsVisible) { // 仅在前台时更新
                    // 清除缓存以强制重新匹配
                    matchResultsCache = null;
                    updateMatchResults();
                }
            }, 1000)
        );
        
        // 配置 observer
        window._keywordMatchObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

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

            // 在 updateMatchResults 函数中
            const matchedResults = [];
            Object.entries(matchResultsCache).forEach(([keyword, elements]) => {
                const matchType = getKeywords().exact.includes(keyword) ? '（精确）' : '（模糊）';
                matchedResults.push(`
                    <div class="match-item">
                        <span class="keyword" data-keyword="${escapeHtml(keyword)}">
                            ${escapeHtml(keyword)}${matchType}
                        </span>：
                        出现 <span class="count">${elements.length}</span> 次
                    </div>
                `);
            });

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
        const { exact, fuzzy } = getKeywords();
        if (!exact.length && !fuzzy.length) {
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
        // 修改后的排除选择器
        const excludeSelectors = [
            '[data-ks-element="true"]', // 直接排除脚本元素
            '[data-ks-element="true"] *', // 排除所有子元素
            '.ks-keywords-dialog',
            '.ks-keywords-dialog *',
            '.ks-match-trigger',
            '.ks-match-trigger *',
            '.match-results',
            '.match-results *'
        ].join(',');

        // 使用:not选择器排除脚本创建的元素
        // 优化后的元素选择器
        const elements = document.querySelectorAll(
            `${selectors}:not(${excludeSelectors})`
        );

        // 获取元素的逻辑保持不变...
        elements.forEach(element => {
            // 深度检查元素层级
            const isInScriptElement = element.closest(`
                [data-ks-element="true"], 
                .ks-keywords-dialog, 
                .ks-match-trigger, 
                .match-results
            `);

            // 排除隐藏元素（添加新检查）
            const isVisible = !!(
                element.offsetWidth ||
                element.offsetHeight ||
                element.getClientRects().length
            );

            if (isInScriptElement || !isVisible) return;

            const rawContent = getTextContent(element);
            const content = cleanText(rawContent);
            if (!content) return;

            // 处理精确匹配
            exact.forEach(keyword => {
                // 添加内容长度验证
                if (content === keyword && content.length === keyword.length) {
                    if (!results[keyword]) results[keyword] = [];
                    results[keyword].push({
                        element,
                        content: rawContent,
                        matches: [{ text: keyword, index: 0 }]
                    });
                }
            });

            // 处理模糊匹配
            fuzzy.forEach(keyword => {
                if (content.includes(keyword) && content.length > keyword.length &&
                // 添加相邻字符验证
                !(
                    content === keyword || 
                    content.startsWith(keyword + " ") || 
                    content.endsWith(" " + keyword) ||
                    content.includes(" " + keyword + " ")
                )
            ) {
                    const matches = [];
                    let index = content.indexOf(keyword);
                    while (index > -1) {
                        matches.push({ text: keyword, index });
                        index = content.indexOf(keyword, index + keyword.length);
                    }
                    if (matches.length) {
                        if (!results[keyword]) results[keyword] = [];
                        results[keyword].push({
                            element,
                            content: rawContent,
                            matches
                        });
                    }
                }
            });
        });

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

        // 延迟执行以确保DOM完全加载
        setTimeout(() => {
            if (document.readyState === 'complete') {
                init();
            } else {
                window.addEventListener('load', init);
            }
        }, 300);
    }

    /********************
     * 初始化脚本执行 *
     ​********************/
    //document.addEventListener('visibilitychange', handleVisibilityChange);
    //window.addEventListener('blur', handleWindowBlur);
    //window.addEventListener('focus', handleWindowFocus);
    const boundHandlers = {
        vis: () => handleVisibilityChange(),
        blur: () => handleWindowBlur(),
        focus: () => handleWindowFocus()
    };
    document.addEventListener('visibilitychange', boundHandlers.vis);
    window.addEventListener('blur', boundHandlers.blur);
    window.addEventListener('focus', boundHandlers.focus);



    // 修改启动脚本逻辑
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAndInit);
    } else {
        checkAndInit();
    }

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

    const nativeQuerySelector = Element.prototype.querySelector;
    Element.prototype.querySelector = function(selector) {
    // 对脚本自己的选择器进行处理
    if(selector.includes('ks-')) {
        return nativeQuerySelector.call(this, selector);
    }
    // 其他选择器保持原生行为
    return nativeQuerySelector.apply(this, arguments);
    };
})()
