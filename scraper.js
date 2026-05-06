const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

async function startScraping() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();
    
    if (!fs.existsSync('subtitles')) fs.mkdirSync('subtitles');

    const albumUrl = "https://home.hitv.vip/ar-ae/album/a_8TWpC3uCmdAdOk5YgJqW";
    let finalJsonData = [];

    // مراقبة الشبكة
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

        for (const sLink of seriesLinks) {
            console.log(`🎬 معالجة: ${sLink}`);
            await page.goto(sLink, { waitUntil: 'domcontentloaded' });
            
            // محاولة إغلاق أي نافذة منبثقة قد تظهر
            try {
                await page.waitForSelector('.van-overlay, .dialogContent', { timeout: 5000 });
                await page.keyboard.press('Escape'); // محاولة إغلاق بالهروب
                console.log("⚠️ تم محاولة إغلاق نافذة منبثقة.");
            } catch (e) {}

            const title = (await page.title()).split('-')[0].trim();
            let series = { title, url: sLink, episodes: [] };

            const episodes = await page.$$('.play-item');
            for (let i = 0; i < episodes.length; i++) {
                console.log(`📡 استخراج الحلقة ${i + 1}...`);
                page.latestM3u8 = null;
                page.latestSub = null;

                // استخدام dispatchEvent بدلاً من click العادي لتجنب intercept
                await episodes[i].dispatchEvent('click');
                
                // انتظار بسيط لظهور الرابط في الشبكة
                await page.waitForTimeout(4000);

                series.episodes.push({
                    episode: i + 1,
                    m3u8: page.latestM3u8 || "N/A",
                    subtitle: page.latestSub || "N/A"
                });
            }
            finalJsonData.push(series);
            
            // حفظ تدريجي لضمان عدم ضياع البيانات إذا حدث خطأ
            fs.writeFileSync('data.json', JSON.stringify(finalJsonData, null, 2));
        }

        console.log("💾 تم الانتهاء بنجاح وحفظ data.json.");

    } catch (err) {
        console.error("❌ خطأ أثناء التشغيل:", err.message);
        if (!fs.existsSync('data.json')) fs.writeFileSync('data.json', '[]');
    } finally {
        await browser.close();
    }
}

startScraping();
