<div align="center">

# MediaWiki for koishi.js

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
// the `app` is koishi App instance
app.plugin('mediawiki', {
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

**一键配置 wiki 与群组连接，无需写死在配置文件**

> **😀 YOU**
>
> wiki.connect https://zh.moegirl.org.cn/api.php`

> **🤖 BOT**
>
> 本群已与“萌娘百科”连接~

### 查找并获取页面链接

兼容中文简繁转换，_此外还可以输出页面摘要（为防止刷屏预设关闭）_

> **🤔 YOU**
>
> 你知道`[[沃利杰诺·梅因]]`吗？快去看看吧！

> **🤖 BOT**
>
> 您要的“`沃利杰诺·梅因`”：<br>https://mzh.moegirl.org.cn/index.php?curid=458522<br>沃利杰诺·梅因（Original/Main）是由机智的小鱼君所创作的小说《将来过去时》及其衍生作品的登场角色。…

> **😏 YOU**
>
> 哇？**她居然能直接识别消息里的 wiki 链接**？那让我来点一份炒饭！<br>比如带上锚点 `[[沃利杰诺·梅因#性格|笨蛋]]`<br>或者干脆 `[[这个条目不存在！]]`<br>然后再试试 `[[Special:MyPage]]` 会不会暴露服务器 IP 地址

> 🤖 BOT
>
> 您要的“`沃利杰诺·梅因`”：<br>https://zh.moegirl.org.cn/index.php?curid=458522#%E6%80%A7%E6%A0%BC
>
> 您要的“这个条目不存在！”：<br>https://zh.moegirl.org.cn/index.php?title=%E8%BF%99%E4%B8%AA%E6%9D%A1%E7%9B%AE%E4%B8%8D%E5%AD%98%E5%9C%A8%EF%BC%81&action=edit (`页面不存在`)
>
> 您要的“`Special:我的用户页`”：<br>https://zh.moegirl.org.cn/index.php?title=Special%3A%E6%88%91%E7%9A%84%E7%94%A8%E6%88%B7%E9%A1%B5 (特殊页面)

> 😍 您
>
> 嚯，完全难不倒她！

### 以及其他超酷的功能

- 搜索 wiki，并给出前几个匹配项的摘要
- 请求条目不存在时，自动使用关键字进行搜索（预设关闭）
- 发送条目的信息框（Infobox）截图（内置萌娘百科、灰机、Fandom 支持，其他 wiki 可能需要自行配置，见下方说明）

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
app.plugin('mediawiki', {
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

- koishi 主程序版本 4.10+
- 需要数据库支持 `koishi-database-*`
- 截图功能需要 `koishi-plugin-puppeteer`

---

    Copyright 2021 Dragon-Fish

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
