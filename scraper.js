const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

function convertXmlToSrt(xmlText) {
    let srt = '';
    const lines = xmlText.match(/<p begin="([^"]+)" end="([^"]+)"[^>]*>(.*?)<\/p>/g);
    if (!lines) return null;
    lines.forEach((line, index) => {
        const match = line.match(/<p begin="([^"]+)" end="([^"]+)"[^>]*>(.*?)<\/p>/);
        if (match) {
            let start = match[1].replace('.', ',');
            let end = match[2].replace('.', ',');
            let text = match[3].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<\/?[^>]+(>|$)/g, "").trim();
            srt += `${index + 1}\n${start} --> ${end}\n${text}\n\n`;
        }
    });
    return srt;
}

async function startScraping() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    if (!fs.existsSync('subtitles')) fs.mkdirSync('subtitles');

    const albumUrl = "https://home.hitv.vip/ar-ae/album/a_8TWpC3uCmdAdOk5YgJqW";
    let allData = [];

    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('.m3u8')) page.latestM3u8 = url;
        if (url.includes('.xml') && url.includes('subtitle')) page.latestSub = url;
    });

    try {
        console.log("🚀 جاري الدخول للموقع...");
        await page.goto(albumUrl, { waitUntil: 'networkidle' });
        const seriesLinks = await page.$$eval('.album a', els => els.map(el => el.href));

        for (const sLink of seriesLinks) {
            await page.goto(sLink, { waitUntil: 'networkidle' });
            const seriesName = (await page.title()).split('-')[0].trim();
            const episodes = await page.$$('.play-item');

            for (let i = 0; i < episodes.length; i++) {
                page.latestM3u8 = null;
                page.latestSub = null;
                await episodes[i].click();
                await page.waitForTimeout(5000);

                let entry = {
                    series: seriesName,
                    episode: i + 1,
                    m3u8: page.latestM3u8 || "N/A",
                    subtitle_url: page.latestSub || "N/A"
                };

                if (page.latestSub) {
                    try {
                        const res = await axios.get(page.latestSub);
                        const srt = convertXmlToSrt(res.data);
                        if (srt) {
                            const subPath = `subtitles/${seriesName}_Ep${i+1}.srt`.replace(/\s+/g, '_');
                            fs.writeFileSync(subPath, srt);
                            entry.local_subtitle = subPath;
                        }
                    } catch (e) { console.log("خطأ في الترجمة"); }
                }
                allData.push(entry);
            }
        }
        fs.writeFileSync('output.json', JSON.stringify(allData, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await browser.close();
    }
}
startScraping();
