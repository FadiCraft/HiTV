const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// دالة تحويل XML إلى SRT
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
    
    // إعداد المجلدات
    if (!fs.existsSync('subtitles')) fs.mkdirSync('subtitles');

    const albumUrl = "https://home.hitv.vip/ar-ae/album/a_8TWpC3uCmdAdOk5YgJqW";
    let allData = [];

    // مراقب الشبكة
    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('.m3u8')) page.latestM3u8 = url;
        if (url.includes('.xml') && url.includes('subtitle')) page.latestSub = url;
    });

    try {
        console.log("🚀 جاري فتح المتصفح...");
        await page.goto(albumUrl, { waitUntil: 'networkidle' });

        // استخراج روابط المسلسلات من الألبوم
        const seriesLinks = await page.$$eval('.album a', els => els.map(el => el.href));
        console.log(`✅ تم العثور على ${seriesLinks.length} مسلسل.`);

        for (const sLink of seriesLinks) {
            console.log(`📖 معالجة: ${sLink}`);
            await page.goto(sLink, { waitUntil: 'networkidle' });
            
            const seriesName = await page.title();
            
            // التعامل مع "Tabs" الحلقات (مثلاً 1-50، 51-100)
            const tabs = await page.$$('.group-tab');
            const tabCount = tabs.length > 0 ? tabs.length : 1;

            for (let t = 0; t < tabCount; t++) {
                if (tabs.length > 0) {
                    await tabs[t].click();
                    await page.waitForTimeout(1000);
                }

                const episodes = await page.$$('.play-item');
                for (let i = 0; i < episodes.length; i++) {
                    const epName = await episodes[i].innerText();
                    console.log(`🎬 حلقة ${epName}...`);

                    page.latestM3u8 = null;
                    page.latestSub = null;

                    await episodes[i].click();
                    await page.waitForTimeout(5000); // وقت كافٍ للتحميل

                    let entry = {
                        series: seriesName,
                        episode: epName,
                        m3u8: page.latestM3u8 || "N/A",
                        subtitle_url: page.latestSub || "N/A"
                    };

                    if (page.latestSub) {
                        try {
                            const response = await axios.get(page.latestSub);
                            const srt = convertXmlToSrt(response.data);
                            if (srt) {
                                const subPath = `subtitles/${seriesName.replace(/\s+/g, '_')}_Ep${epName}.srt`;
                                fs.writeFileSync(subPath, srt);
                                entry.local_subtitle = subPath;
                            }
                        } catch (e) { console.log("⚠️ فشل تحميل الترجمة لهذه الحلقة."); }
                    }
                    allData.push(entry);
                }
            }
        }

        fs.writeFileSync('output.json', JSON.stringify(allData, null, 2));
        console.log("✨ انتهى العمل بنجاح! تم تحديث output.json");

    } catch (err) {
        console.error("❌ خطأ كارثي:", err);
    } finally {
        await browser.close();
    }
}

startScraping();
