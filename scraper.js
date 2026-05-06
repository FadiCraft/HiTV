const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

async function startScraping() {
    // استخدام متصفح مع إعدادات تشبه المستخدم الحقيقي
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    if (!fs.existsSync('subtitles')) fs.mkdirSync('subtitles');

    const albumUrl = "https://home.hitv.vip/ar-ae/album/a_8TWpC3uCmdAdOk5YgJqW";
    let finalJsonData = [];

    page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('.m3u8')) page.latestM3u8 = url;
        if (url.includes('.xml') && url.includes('subtitle')) page.latestSub = url;
    });

    try {
        console.log("🔗 فتح الألبوم...");
        await page.goto(albumUrl, { waitUntil: 'networkidle', timeout: 60000 });

        const seriesLinks = await page.$$eval('.album a', els => els.map(el => el.href));
        console.log(`✅ وجدنا ${seriesLinks.length} مسلسل.`);

        if (seriesLinks.length === 0) {
            console.log("⚠️ لم يتم العثور على مسلسلات، قد يكون الموقع غير متاح أو هناك حماية.");
        }

        for (const sLink of seriesLinks) {
            console.log(`🎬 معالجة: ${sLink}`);
            await page.goto(sLink, { waitUntil: 'networkidle' });
            
            const title = (await page.title()).split('-')[0].trim();
            let series = { title, url: sLink, episodes: [] };

            const episodes = await page.$$('.play-item');
            for (let i = 0; i < episodes.length; i++) {
                page.latestM3u8 = null;
                await episodes[i].click();
                await page.waitForTimeout(5000);

                series.episodes.push({
                    episode: i + 1,
                    m3u8: page.latestM3u8 || "N/A",
                    subtitle: page.latestSub || "N/A"
                });
            }
            finalJsonData.push(series);
        }

        // حفظ الملف حتى لو كانت المصفوفة فارغة لتجنب خطأ الـ Git
        fs.writeFileSync('data.json', JSON.stringify(finalJsonData, null, 2));
        console.log("💾 تم حفظ data.json بنجاح.");

    } catch (err) {
        console.error("❌ خطأ أثناء التشغيل:", err.message);
        // إنشاء ملف فارغ في حال الفشل لتجنب خطأ الرفع
        if (!fs.existsSync('data.json')) fs.writeFileSync('data.json', '[]');
    } finally {
        await browser.close();
    }
}

startScraping();
