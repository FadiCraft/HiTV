const { chromium } = require('playwright');
const fs = require('fs');
const axios = require('axios');

// دالة لتحويل XML الخاص بـ HiTV إلى صيغة SRT
function convertXmlToSrt(xmlText) {
    let srt = '';
    const lines = xmlText.match(/<p begin="([^"]+)" end="([^"]+)"[^>]*>(.*?)<\/p>/g);
    
    if (!lines) return null;

    lines.forEach((line, index) => {
        const match = line.match(/<p begin="([^"]+)" end="([^"]+)"[^>]*>(.*?)<\/p>/);
        if (match) {
            let start = match[1].replace('.', ',');
            let end = match[2].replace('.', ',');
            let text = match[3].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
            
            srt += `${index + 1}\n${start} --> ${end}\n${text}\n\n`;
        }
    });
    return srt;
}

async function startScraping() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const albumUrl = "https://home.hitv.vip/ar-ae/album/a_8TWpC3uCmdAdOk5YgJqW";
    let results = [];

    // مراقبة الشبكة لالتقاط الروابط
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('.m3u8')) {
            page.currentM3u8 = url;
        }
        if (url.includes('.xml') && url.includes('subtitle')) {
            page.currentSubtitle = url;
        }
    });

    try {
        console.log("جاري الدخول لصفحة الألبوم...");
        await page.goto(albumUrl, { waitUntil: 'networkidle' });

        // استخراج روابط المسلسلات داخل الألبوم
        const seriesLinks = await page.$$eval('.album a', els => els.map(el => el.href));

        for (const sLink of seriesLinks) {
            console.log(`جاري معالجة المسلسل: ${sLink}`);
            await page.goto(sLink, { waitUntil: 'networkidle' });
            
            // استخراج قائمة الحلقات
            const episodes = await page.$$('.play-item');
            
            for (let i = 0; i < episodes.length; i++) {
                console.log(`جاري استخراج بيانات الحلقة ${i + 1}...`);
                
                // تصفير الروابط المؤقتة قبل الضغط
                page.currentM3u8 = null;
                page.currentSubtitle = null;

                await episodes[i].click();
                await page.waitForTimeout(4000); // انتظار تحميل المشغل والروابط

                const epData = {
                    episode: i + 1,
                    m3u8: page.currentM3u8 || "لم يتم العثور على رابط",
                    subtitle_url: page.currentSubtitle || "لا توجد ترجمة"
                };

                // تحميل وتحويل الترجمة
                if (page.currentSubtitle) {
                    try {
                        const subRes = await axios.get(page.currentSubtitle);
                        const srtContent = convertXmlToSrt(subRes.data);
                        if (srtContent) {
                            const fileName = `subtitle_ep_${i + 1}.srt`;
                            fs.writeFileSync(fileName, srtContent);
                            epData.local_subtitle = fileName;
                        }
                    } catch (e) {
                        console.error("خطأ في تحميل الترجمة");
                    }
                }

                results.push(epData);
            }
        }

        // حفظ البيانات النهائية في ملف JSON
        fs.writeFileSync('data.json', JSON.stringify(results, null, 2), 'utf-8');
        console.log("تم الانتهاء! تم حفظ الروابط في data.json والترجمات محلياً.");

    } catch (error) {
        console.error("حدث خطأ:", error);
    } finally {
        await browser.close();
    }
}

startScraping();
