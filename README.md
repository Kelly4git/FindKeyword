# 网页关键词查询工具（普通版）

![示例截图](screenshot.png) <!-- 可替换为实际截图文件路径 -->

一款Tampermonkey用户脚本，帮助快速在网页内容中查找、统计关键词，支持高亮匹配和结果导出。

## 功能特性

- 🔍 **双模式匹配**  
  支持精确匹配（完全一致）和模糊匹配（包含关键词）
- 🎨 **智能高亮**  
  动态高亮文本/表单元素中的匹配内容，支持过渡动画
- 📊 **实时统计**  
  悬浮统计面板显示关键词匹配次数，点击快速定位
- 📥 **数据持久化**  
  自动保存关键词配置和域名过滤规则
- 🚀 **性能优化**  
  采用缓存机制和智能DOM监控，减少性能消耗
- 🌐 **域名过滤**  
  支持包含/排除域名列表，精准控制生效范围

## 安装使用

1. **安装脚本管理器**  
   需先安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展

2. **安装用户脚本**  
   [点击此处安装最新版本](https://github.com/Kelly4git/FindKeyword.git)

3. **激活使用**  
   - 点击页面右下角悬浮按钮激活
   - 首次使用需在弹出窗口中设置关键词

## 使用指南

### 基本操作
- 🟡 点击页面右下角黄色悬浮按钮触发搜索
- 📝 右键点击悬浮按钮打开设置面板
- 📌 双击统计项快速滚动到首个匹配位置

### 关键词设置
```text
精确匹配示例：
12345
ABC-100

模糊匹配示例：
error
payment_failed
```

### 高级功能
- 🔄 动态内容监控（自动跟踪AJAX加载内容）
- 🛡️ HTML特殊字符自动转义
- 📤 支持html格式结果导出
- 🎯 智能边界检测（避免数字/字母误匹配）

## 配置选项

### 域名过滤规则
```javascript
// 包含域名（白名单）
*.example.com
admin.*

// 排除域名（黑名单）
*.google.com
dev.test.site
```

### 样式定制
通过修改CSS变量自定义外观：
```css
:root {
  --highlight-color: #ffeb3b;   /* 高亮底色 */
  --outline-color: #ffc107;     /* 边框颜色 */
  --trigger-bg: rgba(255,255,0,0.8); /* 悬浮按钮颜色 */
}
```

## 注意事项

1. **性能提示**  
   在超大型页面（如无限滚动页）建议先过滤域名后使用

2. **兼容性**  
   支持现代浏览器（Chrome 90+/Firefox 85+）

3. **冲突处理**  
   如与其他高亮脚本冲突，可通过添加`data-script-element`属性排除

## 开发支持

欢迎贡献代码或提交问题：[Issues页面](your_github_issues_link)

### 构建说明
```bash
npm install
npm run build
```

## 授权协议

[MIT License](LICENSE) © 2023 Your Name

---

> 提示：本工具仅用于辅助信息检索，请遵守网站使用条款，勿用于敏感数据采集。  
> 项目更新频率：每月常规维护，重大漏洞24小时内响应。  
> 遇到问题请先尝试清除脚本缓存，如仍未解决欢迎提交issue。
