// ==UserScript==
// @name         表单关键词匹配计数工具
// @namespace    http://tampermonkey.net/
// @version      0.1
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

(function() {
    'use strict';

    // 修改样式定义
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
            bottom: 10vh !important;
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
            pointer-events: none !important;
            background: rgba(255, 255, 0, 0.5) !important;
        }
        .match-counter .count {
            color: #ff0000 !important;
            font-weight: bold !important;
        }
    `);

    // 清理文本,保留数字和中英文字符
    function cleanText(text) {
        return text
            .replace(/[\s\uFEFF\xA0]+/g, '')
            .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
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

        // 获取所有文本元素
        const allTextElements = document.querySelectorAll(
            [
                FORM_SELECTORS.inputs,
                FORM_SELECTORS.textAreas,
                FORM_SELECTORS.contentEditable,
                FORM_SELECTORS.textContainers
            ].filter(Boolean).join(',')
        );

        // 处理所有元素
        allTextElements.forEach(element => {
            if (!element.closest('.match-counter') && 
                !element.closest('.keywords-dialog')) {
                let content = '';
                
                // 处理表单元素
                if (element instanceof HTMLInputElement || 
                    element instanceof HTMLTextAreaElement) {
                    content = element.value || element.defaultValue || '';
                } 
                // 处理可编辑元素
                else if (element.isContentEditable) {
                    content = element.innerText || '';
                }
                // 处理其他元素
                else {
                    // 获取元素中的所有文本节点
                    const texts = [];
                    const walker = document.createTreeWalker(
                        element,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                const parent = node.parentElement;
                                // 排除脚本创建的元素
                                if (parent && (
                                    parent.closest('.match-counter') || 
                                    parent.closest('.keywords-dialog'))
                                ) {
                                    return NodeFilter.FILTER_REJECT;
                                }
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        }
                    );

                    let node;
                    while (node = walker.nextNode()) {
                        const text = node.textContent.trim();
                        if (text) {
                            texts.push(text);
                        }
                    }
                    content = texts.join(' ');
                }

                // 匹配关键词
                if (content) {
                    keywords.forEach(keyword => {
                        if (!keyword) return;
                        // 不区分大小写匹配
                        const regex = new RegExp(
                            keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                            'gi'
                        );
                        const matches = content.match(regex);
                        if (matches) {
                            matchCounts[keyword] += matches.length;
                        }
                    });
                }
            }
        });

        // 处理页面中的其他文本内容
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    const parent = node.parentElement;
                    if (!parent || 
                        parent.closest('.match-counter') || 
                        parent.closest('.keywords-dialog')) {
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
                    const regex = new RegExp(
                        keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                        'gi'
                    );
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
            // 只显示有匹配的关键词
            newContent = matchedKeywords
                .map(keyword => `${keyword}：出现 <span class="count">${matchCounts[keyword]}</span> 次`)
                .join('；<br>');
        } else {
            // 没有匹配时显示提示文本
            newContent = '未匹配到关键词';
        }

        // 只在内容变化时更新DOM
        if (counter.innerHTML !== newContent) {
            counter.innerHTML = newContent;
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
            attributeFilter: ['value'], // 只监听value属性
            characterDataOldValue: true // 保存文本变化的旧值
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

    // 添加域名设置菜单
    GM_registerMenuCommand('🌐 配置网站', createDomainDialog);

})();