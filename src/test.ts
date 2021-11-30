import {} from 'cheerio'
import axios from 'axios'

axios.request({ url: 'oni.fandom.com/zh/?curid=262' }).then((res) => {
  console.log(res)
  return
})
