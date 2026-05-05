const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// دالة تحويل الترجمة من XML إلى SRT
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
    const context = await browser.newContext();
    const page = await context.newPage();
    
    if (!fs.existsSync('subtitles')) fs.mkdirSync('subtitles');

    const albumUrl = "https://home.hitv.vip/ar-ae/album/a_8TWpC3uCmdAdOk5YgJqW";
    let finalJsonData = [];

    // مراقبة روابط m3u8 والترجمات من الشبكة
    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('.m3u8')) page.latestM3u8 = url;
        if (url.includes('.xml') && url.includes('subtitle')) page.latestSub = url;
    });

    try {
        console.log("🚀 جاري الدخول لصفحة الألبوم...");
        await page.goto(albumUrl, { waitUntil: 'networkidle' });

        // الحصول على روابط المسلسلات
        const seriesLinks = await page.$$eval('.album a', els => els.map(el => el.href));
        console.log(`✅ تم العثور على ${seriesLinks.length} مسلسل.`);

        for (const sLink of seriesLinks) {
            console.log(`📖 معالجة المسلسل: ${sLink}`);
            await page.goto(sLink, { waitUntil: 'networkidle' });
            
            const seriesTitle = (await page.title()).split('-')[0].trim();
            let seriesObject = {
                title: seriesTitle,
                url: sLink,
                episodes: []
            };

            const episodes = await page.$$('.play-item');
            for (let i = 0; i < episodes.length; i++) {
                const epLabel = await episodes[i].innerText();
                console.log(`🎬 جاري استخراج الحلقة ${epLabel}...`);

                page.latestM3u8 = null;
                page.latestSub = null;

                await episodes[i].click();
                await page.waitForTimeout(5000); // انتظار تحميل الروابط

                let episodeData = {
                    episode_number: epLabel,
                    m3u8_link: page.latestM3u8 || "غير متوفر",
                    subtitle_xml: page.latestSub || "غير متوفر"
                };

                // معالجة الترجمة وحفظها محلياً
                if (page.latestSub && page.latestSub !== "غير متوفر") {
                    try {
                        const subRes = await axios.get(page.latestSub);
                        const srtContent = convertXmlToSrt(subRes.data);
                        if (srtContent) {
                            const fileName = `subtitles/${seriesTitle.replace(/\s+/g, '_')}_Ep${epLabel}.srt`;
                            fs.writeFileSync(fileName, srtContent);
                            episodeData.local_srt_path = fileName;
                        }
                    } catch (e) {
                        console.log(`⚠️ فشل تحميل ترجمة الحلقة ${epLabel}`);
                    }
                }

                seriesObject.episodes.push(episodeData);
            }
            finalJsonData.push(seriesObject);
        }

        // حفظ البيانات النهائية في ملف JSON
        fs.writeFileSync('data.json', JSON.stringify(finalJsonData, null, 4), 'utf-8');
        console.log("✨ اكتملت العملية! تم حفظ البيانات في data.json");

    } catch (err) {
        console.error("❌ حدث خطأ:", err);
    } finally {
        await browser.close();
    }
}

startScraping();
