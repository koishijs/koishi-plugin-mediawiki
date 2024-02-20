<div align="center">

# MediaWiki for koishi.js

<!-- <img src="https://github.com/koishijs/koishi-plugin-mediawiki/assets/44761872/e4f28e88-a997-4563-9a31-bc49e59e8410" width="300"> -->

Koishi.js 的 MediaWiki 插件，将您的群聊与 wiki 站点紧密连接！

</div>

## 如何安装

**SDK 玩家（推荐）**

作者平时都这么玩，一般会确保这个方法是可用的

Add the package:

```sh
# Using pnpm
pnpm add koishi-plugin-mediawiki
# Yarn? Sure.
yarn add koishi-plugin-mediawiki
# Or just npm
npm i koishi-plugin-mediawiki
```

Then in your entry file:

```ts
// Import the plugin
import PluginMediawiki from 'koishi-plugin-mediawiki'
// the `app` is koishi App instance
app.plugin(PluginMediawiki, {
  // configs here...
})
```

**CLI 玩家（也还行，就是配置自定义信息框的时候会很抽象）**

koishi.yml

```yml
plugins:
  mediawiki:
    # configs here...
```

**控制台玩家（我不好说，大概兼容吧……）**

在插件中心搜索`koishi-plugin-mediawiki`

## 特色功能

您正在经营 MediaWiki 网站的附属群聊？为您的 koishi 机器人添加“wiki”指令吧，实用 wiki 功能一网打尽！

### 便捷绑定

一键配置 wiki 与群组连接，无需写死在配置文件

<img src="https://github.com/koishijs/koishi-plugin-mediawiki/assets/44761872/a8cea95a-ccd0-4540-bca7-0e08ba0ce697" width="350">

### 页面链接及详情

**自动识别消息里的 wiki 链接**，兼容中文简繁转换，_此外还可以输出页面摘要（为防止刷屏预设关闭）_

<img src="https://github.com/koishijs/koishi-plugin-mediawiki/assets/44761872/e3ed2558-a3d9-4cf8-90c1-e217a4bdc0dd" width="350">

**还能正确处理锚点**

<img src="https://github.com/koishijs/koishi-plugin-mediawiki/assets/44761872/37cb4a0e-ee54-45a8-b4f6-769e2e186983" width="350">

**处理特殊页面，防止暴露敏感信息**

<img src="https://github.com/koishijs/koishi-plugin-mediawiki/assets/44761872/4ca54731-2615-4097-b5ee-3b5b418de925" width="350">

**即使页面不存在也不会爆炸**

<img src="https://github.com/koishijs/koishi-plugin-mediawiki/assets/44761872/a8f4199e-10a5-4440-816c-1544ddb8b97b" width="350">

### 以及其他超酷的功能

- 搜索 wiki，并给出前几个匹配项的摘要
- 请求条目不存在时，自动使用关键字进行搜索（预设关闭）

<img src="https://github.com/koishijs/koishi-plugin-mediawiki/assets/44761872/9ba55cd7-0c35-4a7e-889f-9eec8ef0d68a" width="350">

- 发送条目的信息框（Infobox）截图（内置萌娘百科、灰机、Fandom 支持，其他 wiki 可能需要自行配置，见下方说明）

**都看到这了，快去安装吧**

<img src="https://github.com/koishijs/koishi-plugin-mediawiki/assets/44761872/708d3c37-f1c6-4731-b549-10572327c11a">

## 配置选项

```ts
interface Config {
  // 指令用户权限
  cmdAuthWiki: number // 1
  cmdAuthConnect: number // 2
  cmdAuthSearch: number // 1
  // 页面不存在时自动搜索（预设关闭）
  searchIfNotExist: boolean
  // wiki 指令附带页面摘要（预设关闭）
  showDetailsByDefault: boolean
  // 额外信息框配置
  customInfoboxes: InfoboxDefinition[]
}
```

### 自定义信息框配置

**SDK 玩家（推荐）**

```ts
// 举个例子
app.plugin(PluginMediawiki, {
  customInfoboxes: [
    {
      // URL匹配规则
      match: (url: URL) => url.host.endsWith('fandom.com'),
      // infobox 选择器列表
      selector: ['.mw-parser-output aside.portable-infobox'],
      // 额外 css
      injectStyles: '.foo { display: none } .bar { display: block }',
    },
  ],
})
```

**CLI/控制台玩家**

写正则表达式的时候得小心点，它真的很抽象，但是我确实没有更好的办法兼容它了

```yml
plugins:
  plugins:
    mediawiki:
      # URL匹配规则，一个正则表达式字符串
      match: '^https?:\/\/.+?\.fandom\.com'
      # infobox 选择器列表
      selector:
        - '.mw-parser-output aside.portable-infobox'
      # 额外 css
      injectStyles: |
        .foo { display: none }
        .bar { display: block }
```

## 系统需求

- koishi 主程序版本 `^4.16.0`
- 需要数据库支持 `koishi-database-*`
- 截图功能需要 `koishi-plugin-puppeteer`

---

    Copyright 2021 Dragon-Fish

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
