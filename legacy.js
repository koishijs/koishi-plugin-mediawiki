module.exports.apply = koishi => {
  koishi
    // .unselect('user')
    .command(
      'wiki <pagename:text>',
      '发送 wiki 链接（本功能需要 QQ 群申请链接到某个 MediaWiki 网站）'
    )
    .option('info', '-i MediaWiki link info')
    .option('set', '-s <api> Set MediaWiki API', {
      authority: 3,
    })
    .option('silent', '-S', {
      type: 'boolean',
    })
    .channelFields(['mwApi'])
    .action(async ({ session, options }, pagename) => {
      if (options.set) {
        try {
          session.channel.mwApi = options.set
          await session.channel._update()
          reply(session, '成功将QQ群与wiki连接')
        } catch (err) {
          reply(session, '将QQ群与wiki连接时发生错误')
        }
        return
      }
      if (!session.groupId) {
        if (!options.silent) reply(session, '本功能仅限QQ群使用。')
        return
      }

      let mwApi = session.channel.mwApi

      if (options.info) {
        reply(
          session,
          mwApi ? `本群已绑定到 ${mwApi}` : '本群未绑定 MediaWiki 网站'
        )
        return
      }

      if (!mwApi) {
        if (!options.silent)
          reply(session, '本功能需要 QQ 群申请链接到某个 MediaWiki 网站')
        return
      }

      let mwIndex = mwApi.replace('api.php', 'index.php')

      var link = `${mwIndex}?${qs.stringify({ title: pagename })}`

      if (!pagename) {
        reply(session, mwIndex)
        return
      }

      axios
        .get(mwApi, {
          params: {
            format: 'json',
            action: 'query',
            prop: 'info',
            inprop: 'url',
            iwurl: true,
            titles: pagename,
          },
        })
        .then(
          ({ data }) => {
            var query = data.query
            if (query && query.pages) {
              var pages = query.pages
              let pageid = parseInt(Object.keys(pages)[0])
              if (isNaN(pageid) || pageid < 1) {
                link += ' (可能不准确)'
              } else {
                link = `您要的 ${
                  pages[pageid].title
                }\n${mwIndex}?${qs.stringify({ curid: pageid })}`
              }
              koishi.logger('mediawiki').info('找到链接')
            } else if (query && query.interwiki) {
              link = query.interwiki[0].url || link
              koishi.logger('mediawiki').info('找到跨语言链接')
            } else {
              koishi.logger('mediawiki').info('页面不存在？')
            }
            reply(session, link)
          },
          err => {
            koishi.logger('mediawiki').warn('Axios 错误', err)
            reply(session, link + ' (似乎出现错误)')
          }
        )
    })

  koishi.middleware(async (session, next) => {
    await next()
    let content = resolveBrackets(session.content)
    let link = /\[\[(.+?)\]\]/.exec(content)
    if (link && link[1]) {
      // console.log('link', link)
      link = link[1]
      session.execute('wiki -S ' + link)
    }
  })
}
