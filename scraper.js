const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

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
            // تنظيف النص من الوسوم و CDATA
            let text = match[3].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<\/?[^>]+(>|$)/g, "").trim();
            srt += `${index + 1}\n${start} --> ${end}\n${text}\n\n`;
        }
    });
    return srt;
}

async function startScraping() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    const dataFilePath = 'data.json';
    if (!fs.existsSync('subtitles')) fs.mkdirSync('subtitles');

    // 1. تصفير الملف في بداية كل تشغيل (تحديث جديد)
    fs.writeFileSync(dataFilePath, JSON.stringify([], null, 2));

    const albumUrl = "https://home.hitv.vip/ar-ae/album/a_8TWpC3uCmdAdOk5YgJqW";

    // مراقبة الشبكة
    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('.m3u8')) page.latestM3u8 = url;
        if (url.includes('.xml') && url.includes('subtitle')) page.latestSub = url;
    });

    try {
        console.log("🔗 جاري فتح الألبوم...");
        await page.goto(albumUrl, { waitUntil: 'networkidle', timeout: 60000 });

        const seriesLinks = await page.$$eval('.album a', els => els.map(el => el.href));
        console.log(`✅ تم العثور على ${seriesLinks.length} مسلسل.`);

        for (const sLink of seriesLinks) {
            console.log(`🎬 معالجة المسلسل: ${sLink}`);
            await page.goto(sLink, { waitUntil: 'domcontentloaded' });
            
            // إغلاق أي نافذة منبثقة
            try {
                await page.waitForSelector('.van-overlay, .dialogContent', { timeout: 3000 });
                await page.keyboard.press('Escape');
            } catch (e) {}

            const title = (await page.title()).split('-')[0].trim();
            let seriesObject = {
                title: title,
                url: sLink,
                extracted_at: new Date().toISOString(),
                episodes: []
            };

            const episodes = await page.$$('.play-item');
            
            for (let i = 0; i < episodes.length; i++) {
                console.log(`   📡 استخراج الحلقة ${i + 1}...`);
                
                // تصفير الروابط المؤقتة قبل الضغط على الحلقة الجديدة
                page.latestM3u8 = null;
                page.latestSub = null;

                await episodes[i].dispatchEvent('click');
                
                // انتظار التقاط الرابط (زيادة الوقت لضمان الاستجابة لجميع الحلقات)
                let attempts = 0;
                while (!page.latestM3u8 && attempts < 10) {
                    await page.waitForTimeout(1000);
                    attempts++;
                }

                let episodeData = {
                    episode: i + 1,
                    m3u8: page.latestM3u8 || "N/A",
                    subtitle_original: page.latestSub || "N/A",
                    srt_path: "N/A"
                };

                // 2. تحويل الترجمة إلى SRT وحفظها
                if (page.latestSub && page.latestSub !== "N/A") {
                    try {
                        const subRes = await axios.get(page.latestSub);
                        const srtContent = convertXmlToSrt(subRes.data);
                        if (srtContent) {
                            const fileName = `subtitles/${title.replace(/[^\w\s]/gi, '')}_Ep${i+1}.srt`.replace(/\s+/g, '_');
                            fs.writeFileSync(fileName, srtContent);
                            episodeData.srt_path = fileName;
                        }
                    } catch (e) {
                        console.log(`   ⚠️ فشل تحويل ترجمة الحلقة ${i + 1}`);
                    }
                }

                seriesObject.episodes.push(episodeData);
            }

            // 3. الحفظ الفوري لكل مسلسل في المصفوفة داخل الملف
            const currentFileContent = fs.readFileSync(dataFilePath, 'utf-8');
            let currentArray = JSON.parse(currentFileContent);
            currentArray.push(seriesObject);
            fs.writeFileSync(dataFilePath, JSON.stringify(currentArray, null, 2));
            
            console.log(`💾 تم تحديث الملف ببيانات: ${title}`);
        }

    } catch (err) {
        console.error("❌ خطأ عام:", err.message);
    } finally {
        await browser.close();
    }
}

startScraping();
