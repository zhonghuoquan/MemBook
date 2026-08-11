// 临时诊断脚本：用 exifr 解析三张照片的 EXIF 数据
const fs = require('fs');
const path = require('path');
const exifrModule = require('exifr');
const exifr = exifrModule.default || exifrModule;

const files = [
  'f:/N-编程/MenBook开发项目/2025-05-05 100127.jpg',
  'f:/N-编程/MenBook开发项目/2025-05-05 100510.jpg',
  'f:/N-编程/MenBook开发项目/2025-05-05 100649.jpg',
];

(async () => {
  for (const file of files) {
    console.log('\n=== ' + path.basename(file) + ' ===');
    const buf = fs.readFileSync(file);
    console.log('文件大小:', buf.length, 'bytes');

    // 1. 全量解析
    try {
      const full = await exifr.parse(buf, { tiff: true, exif: true, gps: true });
      console.log('全量解析成功. 顶层 keys:', Object.keys(full || {}));
      if (full) {
        const dateKeys = ['SubSecDateTimeOriginal', 'DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'DateTime', 'GPSDateStamp', 'GPSTimeStamp'];
        for (const k of dateKeys) {
          if (full[k] !== undefined) console.log('  ' + k + ':', full[k], '(' + typeof full[k] + ')');
        }
      }
    } catch (e) {
      console.log('全量解析失败:', e.message);
    }

    // 2. 只读前 64KB
    try {
      const head = buf.slice(0, 65536);
      const headParse = await exifr.parse(head, { tiff: true, exif: true, gps: true });
      console.log('64KB 头部解析. keys:', Object.keys(headParse || {}));
      if (headParse) {
        const dateKeys = ['SubSecDateTimeOriginal', 'DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'DateTime'];
        for (const k of dateKeys) {
          if (headParse[k] !== undefined) console.log('  ' + k + ':', headParse[k]);
        }
      }
    } catch (e) {
      console.log('64KB 头部解析失败:', e.message);
    }

    // 3. 不带 options 的默认解析
    try {
      const def = await exifr.parse(buf);
      console.log('默认解析. keys:', Object.keys(def || {}));
    } catch (e) {
      console.log('默认解析失败:', e.message);
    }
  }
})();
