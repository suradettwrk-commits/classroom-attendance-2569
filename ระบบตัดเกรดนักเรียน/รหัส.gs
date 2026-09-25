/**
 * SMART GRADING SYSTEM (ระบบตัดเกรดอัจฉริยะ)
 * โรงเรียนวัดไร่ขิงวิทยา | ครูสุรเดช ธรรมประโชติ
 */

const CONFIG = {
  TARGET_DB_ID: '1YeQMLPOhMOJQBZDWcnuXud9h7M6pPNxbZHo9m8k_lW8',
  SOURCE_DB_ID: '1YG0O9588MXtEmKqEr897JT8lE8XajkToYEfMHrnnvhU',

  SHEET_NAMES: {
    SETTINGS: 'GradeSettings',
    EXAMS: 'ExamScores',
    ADJUSTMENTS: 'ScoreAdjustments',
    TEACHER_SETTINGS: 'TeacherSettings',
    CONFIG: 'Config',
    
    SRC_STUDENTS: 'Students',
    SRC_ASSIGNMENTS: 'Assignments',
    SRC_SCORES: 'Scores',
    SRC_SUBJECTS: 'Subjects'
  },

  HEADERS: {
    SETTINGS: ['Term', 'SubjectCode', 'Level', 'Room', 'TargetPercent', 'WeightPre', 'WeightMid', 'WeightPost', 'WeightFinal', 'GoalPercent', 'LastUpdated'],
    EXAMS: ['Term', 'SubjectCode', 'StudentID', 'MidtermScore', 'FinalScore', 'LastUpdated', 'PreScore', 'PostScore'],
    ADJUSTMENTS: ['AdjustID', 'Timestamp', 'Term', 'SubjectCode', 'StudentID', 'AdjustType', 'ScoreValue', 'Reason', 'Recorder'],
    TEACHER_SETTINGS: ['UserID', 'TeacherName', 'SubjectCode', 'RoomTaught', 'LastUpdated']
  }
};

let _TARGET_SS = null;
let _SOURCE_SS = null;

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  // รับค่า UID และ Name ที่ส่งมาจากระบบหลัก
  template.uid = (e && e.parameter && e.parameter.uid) ? e.parameter.uid : 'guest';
  template.uname = (e && e.parameter && e.parameter.name) ? e.parameter.name : 'ไม่ระบุตัวตน';
  
  return template.evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setTitle('ระบบตัดเกรด - ครูสุรเดช ธรรมประโชติ')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getTargetDb() {
  if (_TARGET_SS) return _TARGET_SS;
  try {
    _TARGET_SS = SpreadsheetApp.openById(CONFIG.TARGET_DB_ID);
    return _TARGET_SS;
  } catch (e) {
    throw new Error("ไม่สามารถเปิด Spreadsheet ระบบตัดเกรดได้ กรุณาตรวจสอบ ID: " + e.message);
  }
}

function getSourceDb() {
  if (_SOURCE_SS) return _SOURCE_SS;
  try {
    _SOURCE_SS = SpreadsheetApp.openById(CONFIG.SOURCE_DB_ID);
    return _SOURCE_SS;
  } catch (e) {
    throw new Error("ไม่สามารถเปิด Spreadsheet ระบบเช็คงานได้ (ข้อมูลต้นทาง): " + e.message);
  }
}

function setupTargetDatabase() {
  try {
    ensureSchemaAndHeaders();
    const ss = getTargetDb();
    
    const defaultSheet1 = ss.getSheetByName('Sheet1');
    const defaultSheet2 = ss.getSheetByName('แผ่นที่ 1');
    if (defaultSheet1 && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet1);
    if (defaultSheet2 && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet2);
    
    const keys = ['SETTINGS', 'EXAMS', 'ADJUSTMENTS', 'TEACHER_SETTINGS', 'CONFIG'];
    keys.forEach(key => {
      const sheetName = CONFIG.SHEET_NAMES[key];
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        const lastCol = sheet.getLastColumn();
        if (lastCol > 0) {
          for (let i = 1; i <= lastCol; i++) {
            sheet.autoResizeColumn(i);
          }
        }
      }
    });
    
    Logger.log("✅ สร้างชีทและคอลัมน์สำเร็จ! ฐานข้อมูลระบบตัดเกรดพร้อมใช้งานครับ");
    return "Setup Complete";
  } catch(e) {
    Logger.log("❌ เกิดข้อผิดพลาดในการ Setup: " + e.message);
    throw e;
  }
}

function ensureSchemaAndHeaders() {
  const ss = getTargetDb();
  const keys = ['SETTINGS', 'EXAMS', 'ADJUSTMENTS', 'TEACHER_SETTINGS'];
  
  keys.forEach(key => {
    const sheetName = CONFIG.SHEET_NAMES[key];
    const requiredHeaders = CONFIG.HEADERS[key];
    
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    
    const currentHeaders = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
    
    if (key === 'TEACHER_SETTINGS' && currentHeaders.length > 0 && currentHeaders[0] !== 'UserID') {
        sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    }
    else if (requiredHeaders && currentHeaders.length === 0) {
        sheet.appendRow(requiredHeaders);
        sheet.getRange(1, 1, 1, requiredHeaders.length)
             .setFontWeight('bold')
             .setBackground('#4e73df')
             .setFontColor('white')
             .setHorizontalAlignment('center');
        sheet.setFrozenRows(1);
    }
  });

  const configName = CONFIG.SHEET_NAMES.CONFIG;
  let sConfig = ss.getSheetByName(configName);
  if (!sConfig) {
      sConfig = ss.insertSheet(configName);
      sConfig.appendRow(['Key', 'Value']);
      sConfig.getRange(1, 1, 1, 2)
             .setFontWeight('bold')
             .setBackground('#4e73df')
             .setFontColor('white')
             .setHorizontalAlignment('center');
      sConfig.setFrozenRows(1);
  }
  if (sConfig.getLastRow() < 2) {
      sConfig.appendRow(['CURRENT_TERM', '2/2568']); 
  }
}

function normalizeSubjectCode(code) { return code ? String(code).trim() : ""; }
function formatDate(date) { return date ? Utilities.formatDate(new Date(date), "GMT+7", "yyyy-MM-dd HH:mm:ss") : ""; }

function getCurrentTerm() {
  try {
    const configSheet = getTargetDb().getSheetByName(CONFIG.SHEET_NAMES.CONFIG);
    if (!configSheet || configSheet.getLastRow() < 1) return '2/2568';
    const data = configSheet.getRange(1, 1, configSheet.getLastRow(), 2).getDisplayValues(); 
    const termRow = data.find(r => r[0] === 'CURRENT_TERM');
    return termRow ? String(termRow[1]).trim() : '2/2568';
  } catch(e) { return '2/2568'; }
}

function sanitizeTerm_(term, fallback = null) {
  if (!term || term === '' || Object.prototype.toString.call(term) === '[object Date]') {
      return fallback !== null ? fallback : getCurrentTerm();
  }
  return String(term).trim();
}

function getInitialDropdowns() {
  try {
    const srcDb = getSourceDb();
    const tgtDb = getTargetDb();
    let levels = new Set(), rooms = new Set(), subjects = [];
    
    const sSheet = srcDb.getSheetByName(CONFIG.SHEET_NAMES.SRC_STUDENTS);
    if (sSheet && sSheet.getLastRow() > 1) {
      const sData = sSheet.getRange(2, 5, sSheet.getLastRow()-1, 2).getDisplayValues();
      sData.forEach(r => { if(r[0]) levels.add(String(r[0]).trim()); if(r[1]) rooms.add(String(r[1]).trim()); });
    }
    
    const subjSheet = srcDb.getSheetByName(CONFIG.SHEET_NAMES.SRC_SUBJECTS);
    if (subjSheet && subjSheet.getLastRow() > 1) {
      subjects = subjSheet.getRange(2, 1, subjSheet.getLastRow()-1, 3).getDisplayValues()
        .map(r => ({ code: String(r[0]).trim(), name: String(r[1]).trim(), teacher: String(r[2]).trim() })).filter(s => s.code);
    }

    let teacherSettingsArray = [];
    
    ensureSchemaAndHeaders();
    const tsSheet = tgtDb.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_SETTINGS);
    if (tsSheet && tsSheet.getLastRow() > 1) {
       const tsData = tsSheet.getDataRange().getDisplayValues();
       for(let i=1; i<tsData.length; i++) {
           teacherSettingsArray.push({
               userId: String(tsData[i][0]).trim(),
               teacherName: String(tsData[i][1]).trim(),
               subjectCode: String(tsData[i][2]).trim(),
               room: String(tsData[i][3]).trim()
           });
       }
    }

    return { 
      success: true,
      levels: Array.from(levels).sort(), 
      rooms: Array.from(rooms).sort((a,b) => parseInt(a) - parseInt(b) || String(a).localeCompare(String(b))), 
      subjects: subjects, 
      term: getCurrentTerm(),
      teacherSettings: teacherSettingsArray
    };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function getRootFolders() {
    try {
        const folders = DriveApp.getRootFolder().getFolders();
        const list = [];
        let count = 0;
        while(folders.hasNext() && count < 100) {
            let f = folders.next();
            list.push({id: f.getId(), name: f.getName()});
            count++;
        }
        list.sort((a,b) => a.name.localeCompare(b.name));
        return { success: true, folders: list };
    } catch(e) {
        return { success: false, message: e.message };
    }
}

function getSummaryDataForExport(term, subjectCode, currentLevelRoom) {
  try {
      const tgtDb = getTargetDb();
      const srcDb = getSourceDb();
      
      term = sanitizeTerm_(term);
      subjectCode = normalizeSubjectCode(subjectCode);
      
      const tsSheet = tgtDb.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_SETTINGS);
      const taughtRooms = []; 
      let teacherName = "ครูผู้สอน";

      if (tsSheet && tsSheet.getLastRow() > 1) {
          const tsData = tsSheet.getDataRange().getDisplayValues();
          for(let i=1; i<tsData.length; i++) {
              if(String(tsData[i][2]).trim() === subjectCode) {
                  taughtRooms.push(String(tsData[i][3]).trim());
                  if (String(tsData[i][1]).trim() !== '') teacherName = String(tsData[i][1]).trim();
              }
          }
      }
      
      if (taughtRooms.length === 0 && currentLevelRoom) {
          taughtRooms.push(currentLevelRoom);
      }

      const exSheet = tgtDb.getSheetByName(CONFIG.SHEET_NAMES.EXAMS);
      const exams = {};
      if (exSheet && exSheet.getLastRow() > 1) {
          const vals = exSheet.getRange(2, 1, exSheet.getLastRow() - 1, 8).getDisplayValues();
          vals.forEach(r => {
              if (String(r[0]).trim() === term && String(r[1]).trim() === subjectCode) {
                  exams[String(r[2]).trim()] = { 
                      mid: r[3] !== '' ? Number(r[3]) : 0, 
                      final: r[4] !== '' ? Number(r[4]) : 0,
                      pre: r[6] !== '' && r[6] !== undefined ? Number(r[6]) : 0,
                      post: r[7] !== '' && r[7] !== undefined ? Number(r[7]) : 0,
                      hasRecord: true
                  };
              }
          });
      }

      const stSheet = srcDb.getSheetByName(CONFIG.SHEET_NAMES.SRC_STUDENTS);
      const studentsByRoom = {};
      
      taughtRooms.sort((a,b) => {
          let numA = parseInt(a.split('/')[1] || 0);
          let numB = parseInt(b.split('/')[1] || 0);
          return numA - numB;
      }).forEach(tr => studentsByRoom[tr] = []);
      
      if (stSheet && stSheet.getLastRow() > 1) {
          const vals = stSheet.getRange(2, 1, stSheet.getLastRow()-1, 11).getDisplayValues();
          vals.forEach(r => {
              const rTerm = r[10] ? String(r[10]).trim() : "";
              const rLevel = String(r[4]).trim();
              const rRoom = String(r[5]).trim();
              const trKey = `${rLevel}/${rRoom}`;
              
              if ((rTerm === "" || rTerm === term) && studentsByRoom[trKey] !== undefined) {
                  studentsByRoom[trKey].push({ id: String(r[0]).trim() });
              }
          });
      }

      const summary = [];
      let grandTotal = { 
          total: 0, max: 0, min: 999, 
          grades: { '4':0, '3.5':0, '3':0, '2.5':0, '2':0, '1.5':0, '1':0, '0':0, 'ร':0, 'มส.':0 }, 
          att: { '3':0, '2':0, '1':0, '0':0 }, 
          read: { '3':0, '2':0, '1':0, '0':0 } 
      };

      Object.keys(studentsByRoom).forEach(roomKey => {
          const stList = studentsByRoom[roomKey];
          
          let displayRoom = roomKey.startsWith('ม.') ? roomKey : `ม.${roomKey}`;
          displayRoom = displayRoom.replace('ม.ม.', 'ม.');

          const roomStats = { 
              room: displayRoom, 
              total: stList.length, 
              max: 0, min: 999, 
              grades: { '4':0, '3.5':0, '3':0, '2.5':0, '2':0, '1.5':0, '1':0, '0':0, 'ร':0, 'มส.':0 }, 
              att: { '3':0, '2':0, '1':0, '0':0 }, 
              read: { '3':0, '2':0, '1':0, '0':0 } 
          };
          
          if(stList.length === 0) roomStats.min = 0;

          stList.forEach(std => {
              const ex = exams[std.id];
              if (!ex || !ex.hasRecord || (ex.pre + ex.mid + ex.post + ex.final === 0)) {
                  roomStats.grades['มส.']++;
                  roomStats.min = 0;
                  return;
              }
              
              const total = ex.pre + ex.mid + ex.post + ex.final;
              if (total > roomStats.max) roomStats.max = total;
              if (total < roomStats.min) roomStats.min = total;

              let g = '0';
              if(total >= 80) g = '4';
              else if(total >= 75) g = '3.5';
              else if(total >= 70) g = '3';
              else if(total >= 65) g = '2.5';
              else if(total >= 60) g = '2';
              else if(total >= 55) g = '1.5';
              else if(total >= 50) g = '1';
              roomStats.grades[g]++;

              let att = '1'; 
              if(total >= 65) att = '3';
              else if(total >= 55) att = '2'; 
              else if(total >= 50) att = '1';
              roomStats.att[att]++;

              let read = '1';
              if(total >= 70) read = '3'; 
              else if(total >= 55) read = '2'; 
              else if(total >= 50) read = '1';
              roomStats.read[read]++;
          });

          if (roomStats.min === 999) roomStats.min = 0;
          summary.push(roomStats);

          grandTotal.total += roomStats.total;
          if (roomStats.max > grandTotal.max) grandTotal.max = roomStats.max;
          if (roomStats.min < grandTotal.min && roomStats.total > 0) grandTotal.min = roomStats.min;
          Object.keys(grandTotal.grades).forEach(k => grandTotal.grades[k] += roomStats.grades[k]);
          Object.keys(grandTotal.att).forEach(k => grandTotal.att[k] += roomStats.att[k]);
          Object.keys(grandTotal.read).forEach(k => grandTotal.read[k] += roomStats.read[k]);
      });

      if (grandTotal.min === 999) grandTotal.min = 0;

      const over3 = grandTotal.grades['4'] + grandTotal.grades['3.5'] + grandTotal.grades['3'];
      const targetPercent = grandTotal.total > 0 ? ((over3 / grandTotal.total) * 100).toFixed(2) : '0.00';
      
      let sumGradePoints = 
          (grandTotal.grades['4'] * 4) + 
          (grandTotal.grades['3.5'] * 3.5) + 
          (grandTotal.grades['3'] * 3) + 
          (grandTotal.grades['2.5'] * 2.5) + 
          (grandTotal.grades['2'] * 2) + 
          (grandTotal.grades['1.5'] * 1.5) + 
          (grandTotal.grades['1'] * 1);
      const validGradesCount = grandTotal.total - grandTotal.grades['ร'] - grandTotal.grades['มส.'];
      const avgGrade = validGradesCount > 0 ? (sumGradePoints / validGradesCount).toFixed(2) : '0.00';

      let sumAttPoints = (grandTotal.att['3'] * 3) + (grandTotal.att['2'] * 2) + (grandTotal.att['1'] * 1);
      const avgAtt = grandTotal.total > 0 ? (sumAttPoints / grandTotal.total).toFixed(2) : '0.00';

      let sumReadPoints = (grandTotal.read['3'] * 3) + (grandTotal.read['2'] * 2) + (grandTotal.read['1'] * 1);
      const avgRead = grandTotal.total > 0 ? (sumReadPoints / grandTotal.total).toFixed(2) : '0.00';

      let subjectName = subjectCode;
      const subjSheet = srcDb.getSheetByName(CONFIG.SHEET_NAMES.SRC_SUBJECTS);
      if (subjSheet && subjSheet.getLastRow() > 1) {
          const sData = subjSheet.getRange(2, 1, subjSheet.getLastRow(), 2).getDisplayValues();
          const match = sData.find(s => String(s[0]).trim() === subjectCode);
          if (match) subjectName = `${subjectCode} ${String(match[1]).trim()}`;
      }

      return {
          success: true,
          data: {
              teacherName: teacherName,
              term: term,
              subjectCode: subjectCode,
              subjectName: subjectName,
              summary: summary,
              grandTotal: grandTotal,
              avgGrade: avgGrade,
              avgAtt: avgAtt,
              avgRead: avgRead,
              targetPercent: targetPercent
          }
      };

  } catch (e) {
      return { success: false, message: e.toString() };
  }
}

function checkExistingExportFile(term, subjectCode, level) {
    const fileName = `รายงานผลการเรียน_${subjectCode}_ม.${level}_เทอม${term.replace('/','-')}`;
    const files = DriveApp.getFilesByName(fileName);
    if (files.hasNext()) {
        const file = files.next();
        return { exists: true, fileId: file.getId(), fileName: fileName };
    }
    return { exists: false, fileName: fileName };
}

function exportSummaryToSheet(term, subjectCode, levelRoom, folderId, overwriteFileId, studentDataArray) {
    try {
        const sumRes = getSummaryDataForExport(term, subjectCode, levelRoom);
        if (!sumRes.success) throw new Error(sumRes.message);
        const d = sumRes.data;

        const ss = overwriteFileId ? SpreadsheetApp.openById(overwriteFileId) : SpreadsheetApp.create(`รายงานผลการเรียน_${subjectCode}_ม.${levelRoom.split('/')[0]}_เทอม${term.replace('/','-')}`);
        
        let sheet1 = ss.getSheetByName('รายชื่อนักเรียน');
        if (!sheet1) {
            sheet1 = ss.insertSheet('รายชื่อนักเรียน', 0);
        }
        sheet1.clear();

        // 1. เขียน Sheet รายชื่อนักเรียน
        const header1 = [
            [`รายงานคะแนนรายบุคคล วิชา ${d.subjectName}`, '', '', '', '', '', '', '', '', '', ''],
            [`ชั้นมัธยมศึกษาปีที่ ${levelRoom} ภาคเรียนที่ ${term}`, '', '', '', '', '', '', '', '', '', ''],
            ['ที่', 'รหัส', 'ชื่อ-นามสกุล', 'ก่อน', 'กลาง', 'หลัง', 'ปลาย', 'รวม', 'เกรด', 'คุณลักษณะ', 'อ่านคิดฯ']
        ];
        
        const rows1 = studentDataArray.map(s => [
            s.no, s.id, s.name, s.pre, s.mid, s.post, s.final, s.total, s.grade, s.att, s.read
        ]);

        sheet1.getRange(1, 1, header1.length, 11).setValues(header1);
        if (rows1.length > 0) sheet1.getRange(4, 1, rows1.length, 11).setValues(rows1);
        
        sheet1.getRange("A1:K1").mergeAcross().setHorizontalAlignment("center").setFontSize(14).setFontWeight("bold");
        sheet1.getRange("A2:K2").mergeAcross().setHorizontalAlignment("center").setFontSize(12);
        sheet1.getRange("A3:K3").setBackground("#f1f5f9").setFontWeight("bold").setHorizontalAlignment("center");
        sheet1.getRange(4, 1, rows1.length > 0 ? rows1.length : 1, 11).setHorizontalAlignment("center");
        sheet1.getRange(4, 3, rows1.length > 0 ? rows1.length : 1, 1).setHorizontalAlignment("left");
        sheet1.autoResizeColumns(1, 11);

        // 2. เขียน Sheet สรุปผล
        let sheet2 = ss.getSheetByName('สรุปผลการเรียน');
        if (!sheet2) {
            sheet2 = ss.insertSheet('สรุปผลการเรียน', 1);
        }
        sheet2.clear();

        const headerArray = [
            [`แบบแสดงระดับผลการเรียนรายวิชา รายวิชา ${d.subjectName}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
            [`ของนักเรียนชั้นมัธยมศึกษาปีที่ ${levelRoom.split('/')[0]}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
            [`ภาคเรียนที่ ${term} ปีการศึกษา 2568 โรงเรียนวัดไร่ขิงวิทยา ของครูผู้สอน ${d.teacherName}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
            ['ชั้น\nม. .../...', 'จำนวน\nนักเรียน\nทั้งหมด', 'คะแนน\nสูงสุด', 'คะแนน\nต่ำสุด', 'ระดับผลการเรียน', '', '', '', '', '', '', '', '', '', 'คุณลักษณะอันพึงประสงค์', '', '', '', 'การอ่าน คิดวิเคราะห์\nและเขียนสื่อความ', '', '', ''],
            ['', '', '', '', 'ผ่าน', '', '', '', '', '', '', 'ไม่ผ่าน', '', '', 'ดย', 'ด', 'ผ', 'มผ', 'ดย', 'ด', 'ผ', 'มผ'],
            ['', '', '', '', '4', '3.5', '3', '2.5', '2', '1.5', '1', '0', 'ร', 'มส.', '', '', '', '', '', '', '', '']
        ];

        const dataRows = [];
        d.summary.forEach(r => {
            dataRows.push([
                r.room, r.total, r.max, r.min, 
                r.grades['4'], r.grades['3.5'], r.grades['3'], r.grades['2.5'], r.grades['2'], r.grades['1.5'], r.grades['1'], 
                r.grades['0'], r.grades['ร'], r.grades['มส.'],
                r.att['3'], r.att['2'], r.att['1'], r.att['0'],
                r.read['3'], r.read['2'], r.read['1'], r.read['0']
            ]);
        });

        const gt = d.grandTotal;
        const totalRow = [
            'รวม', gt.total, gt.max, gt.min,
            gt.grades['4'], gt.grades['3.5'], gt.grades['3'], gt.grades['2.5'], gt.grades['2'], gt.grades['1.5'], gt.grades['1'], 
            gt.grades['0'], gt.grades['ร'], gt.grades['มส.'],
            gt.att['3'], gt.att['2'], gt.att['1'], gt.att['0'],
            gt.read['3'], gt.read['2'], gt.read['1'], gt.read['0']
        ];

        const footerArray = [
            ['ระดับผลการเรียนเฉลี่ย', '', '', '', d.avgGrade, '', '', '', '', '', '', '', '', '', d.avgAtt, '', '', '', d.avgRead, '', '', ''],
            ['ร้อยละของระดับผลการเรียนเป็นไปตามค่าเป้าหมาย (3 ขึ้นไป) ของโรงเรียน', '', '', '', '', '', '', '', '', '', '', 'คิดเป็นร้อยละ', '', '', d.targetPercent, '', '', '', '', '', '', ''],
            ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
            ['', '', '', '', '', '', '', '', '', '', '', `ลงชื่อ ....................................................ครูผู้สอน`, '', '', '', '', '', '', '', '', '', ''],
            ['', '', '', '', '', '', '', '', '', '', '', `(${d.teacherName})`, '', '', '', '', '', '', '', '', '', ''],
            ['', '', '', '', '', '', '', '', '', '', '', `วันที่ ...... เดือน ................. พ.ศ. ........`, '', '', '', '', '', '', '', '', '', '']
        ];

        const finalData = headerArray.concat(dataRows, [totalRow], footerArray);
        sheet2.getRange(1, 1, finalData.length, 22).setValues(finalData);

        sheet2.getRange(1, 1, finalData.length, 22).setHorizontalAlignment("center").setVerticalAlignment("middle").setFontFamily("Sarabun").setFontSize(10);
        sheet2.getRange(1, 1, 3, 22).setFontWeight("bold").setFontSize(12);

        sheet2.getRange("A1:V1").mergeAcross();
        sheet2.getRange("A2:V2").mergeAcross();
        sheet2.getRange("A3:V3").mergeAcross();

        sheet2.getRange("A4:A6").merge();
        sheet2.getRange("B4:B6").merge();
        sheet2.getRange("C4:C6").merge();
        sheet2.getRange("D4:D6").merge();
        
        sheet2.getRange("E4:N4").mergeAcross().setFontWeight("bold"); 
        sheet2.getRange("O4:R5").merge().setFontWeight("bold"); 
        sheet2.getRange("S4:V5").merge().setFontWeight("bold"); 

        sheet2.getRange("E5:K5").mergeAcross().setFontWeight("bold"); 
        sheet2.getRange("L5:N5").mergeAcross().setFontWeight("bold"); 

        const rAvg = 6 + dataRows.length + 1; 
        sheet2.getRange(`A${rAvg}:D${rAvg}`).mergeAcross().setFontWeight("bold").setHorizontalAlignment("right");
        sheet2.getRange(`E${rAvg}:N${rAvg}`).mergeAcross().setFontWeight("bold");
        sheet2.getRange(`O${rAvg}:R${rAvg}`).mergeAcross().setFontWeight("bold");
        sheet2.getRange(`S${rAvg}:V${rAvg}`).mergeAcross().setFontWeight("bold");

        const rTarget = rAvg + 1; 
        sheet2.getRange(`A${rTarget}:K${rTarget}`).mergeAcross().setFontWeight("bold").setHorizontalAlignment("right");
        sheet2.getRange(`L${rTarget}:N${rTarget}`).mergeAcross().setFontWeight("bold");
        sheet2.getRange(`O${rTarget}:V${rTarget}`).mergeAcross().setFontWeight("bold");

        const rSign = rTarget + 2;
        sheet2.getRange(`L${rSign}:T${rSign}`).mergeAcross();
        sheet2.getRange(`L${rSign+1}:T${rSign+1}`).mergeAcross();
        sheet2.getRange(`L${rSign+2}:T${rSign+2}`).mergeAcross();

        const dataRangeRows = 6 + dataRows.length + 2; 
        sheet2.getRange(4, 1, dataRangeRows - 3, 22).setBorder(true, true, true, true, true, true, "black", SpreadsheetApp.BorderStyle.SOLID);
        
        sheet2.getRange("E6:K" + (6 + dataRows.length)).setBackground("#dbeafe"); 
        sheet2.getRange("O6:R" + (6 + dataRows.length)).setBackground("#e0e7ff");
        sheet2.getRange("S6:V" + (6 + dataRows.length)).setBackground("#e0e7ff");
        sheet2.getRange(`A${rAvg-1}:V${rAvg-1}`).setBackground("#f1f5f9").setFontWeight("bold"); 

        const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่นที่ 1');
        if (defaultSheet && ss.getSheets().length > 1) {
            ss.deleteSheet(defaultSheet);
        }

        if (!overwriteFileId && folderId && folderId.trim() !== '') {
            try {
                let fId = folderId;
                if (folderId.includes('/folders/')) {
                    fId = folderId.split('/folders/')[1].split('?')[0]; 
                }
                const file = DriveApp.getFileById(ss.getId());
                const folder = DriveApp.getFolderById(fId);
                file.moveTo(folder);
            } catch(err) {
                Logger.log("ไม่สามารถย้ายไฟล์เข้าโฟลเดอร์ได้: " + err);
            }
        }

        return { success: true, url: ss.getUrl() };

    } catch (e) {
        return { success: false, message: e.toString() };
    }
}

function checkTeacherPermission_(subjectCode, roomTaught, userId) {
  if (!subjectCode || !roomTaught || userId === 'admin') return true; 
  const ss = getTargetDb();
  const tsSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_SETTINGS);
  if (!tsSheet || tsSheet.getLastRow() <= 1) return true; 
  
  const data = tsSheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim() === String(subjectCode).trim() && 
        String(data[i][3]).trim() === String(roomTaught).trim()) {
        
        const ownerId = String(data[i][0]).trim();
        if (ownerId !== '' && ownerId !== String(userId).trim()) {
            return false; 
        }
        return true; 
    }
  }
  return true; 
}

function saveBatchExamScores(payloads, adjustments, roomStr, userId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if ((!payloads || payloads.length === 0) && (!adjustments || adjustments.length === 0)) return { success: true };

    const subject = (payloads && payloads.length > 0) ? payloads[0].subject : (adjustments && adjustments.length > 0 ? adjustments[0].subject : null);
    if (subject && roomStr && !checkTeacherPermission_(subject, roomStr, userId)) {
        return { success: false, message: 'ไม่อนุญาตให้บันทึก: วิชานี้และห้องนี้ถูกตัดเกรดโดยครูท่านอื่นแล้ว (รหัสผู้ใช้ไม่ตรงกัน)' };
    }

    const ss = getTargetDb();
    const ts = new Date();
    
    if (payloads && payloads.length > 0) {
        const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.EXAMS);
        const data = sheet.getDataRange().getDisplayValues();
        
        const rowMap = {};
        for(let i=1; i<data.length; i++) {
            const key = `${String(data[i][0]).trim()}_${String(data[i][1]).trim()}_${String(data[i][2]).trim()}`;
            rowMap[key] = i + 1; 
        }

        payloads.forEach(p => {
            const term = String(sanitizeTerm_(p.term)).trim();
            const subj = String(p.subject).trim();
            const stdId = String(p.studentId).trim();
            const key = `${term}_${subj}_${stdId}`;
            const rowIndex = rowMap[key];

            if (rowIndex) {
                if (p.scores.mid !== undefined) sheet.getRange(rowIndex, 4).setValue(p.scores.mid);
                if (p.scores.final !== undefined) sheet.getRange(rowIndex, 5).setValue(p.scores.final);
                sheet.getRange(rowIndex, 6).setValue(ts);
                if (p.scores.pre !== undefined) sheet.getRange(rowIndex, 7).setValue(p.scores.pre);
                if (p.scores.post !== undefined) sheet.getRange(rowIndex, 8).setValue(p.scores.post);
            } else {
                sheet.appendRow([
                    term, subj, stdId, 
                    p.scores.mid !== undefined ? p.scores.mid : '', 
                    p.scores.final !== undefined ? p.scores.final : '', 
                    ts, 
                    p.scores.pre !== undefined ? p.scores.pre : '', 
                    p.scores.post !== undefined ? p.scores.post : ''
                ]);
                rowMap[key] = sheet.getLastRow();
            }
        });
    }

    if (adjustments && adjustments.length > 0) {
        const adjSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ADJUSTMENTS);
        adjustments.forEach(adj => {
            const adjustId = 'ADJ-' + ts.getTime() + '-' + Math.floor(Math.random() * 1000);
            adjSheet.appendRow([
                adjustId,
                ts, 
                String(sanitizeTerm_(adj.term)).trim(), 
                String(adj.subject).trim(), 
                String(adj.studentId).trim(), 
                String(adj.type).trim(), 
                adj.newValue !== undefined ? adj.newValue : (Number(adj.value) || 0), 
                adj.reason, 
                adj.recorder,
                adj.oldValue !== undefined ? adj.oldValue : '-' // [FIX] บันทึกคะแนนเก่าลงคอลัมน์ J
            ]);
        });
    }

    return { success: true };
  } catch(e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function saveTeacherSettings(payload, userId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const subjectCode = String(payload.subjectCode).trim();
    const roomTaught = String(payload.room).trim();
    
    if (!checkTeacherPermission_(subjectCode, roomTaught, userId)) {
        return { success: false, message: 'ไม่สามารถแย่งสิทธิ์ได้: ห้องนี้ถูกลงทะเบียนตัดเกรดโดยครูท่านอื่นแล้ว' };
    }

    const ss = getTargetDb();
    ensureSchemaAndHeaders();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_SETTINGS);
    const ts = new Date();

    const data = sheet.getDataRange().getDisplayValues();
    let rowIndex = -1;
    
    for(let i=1; i<data.length; i++) {
        if(String(data[i][2]).trim() === subjectCode && String(data[i][3]).trim() === roomTaught) {
            rowIndex = i + 1; break;
        }
    }

    const rowData = [userId, payload.teacherName, subjectCode, roomTaught, ts];
    
    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, 5).setValues([rowData]);
    else sheet.appendRow(rowData);

    return { success: true, message: 'บันทึกการตั้งค่าครูผู้สอนสำเร็จ' };
  } catch(e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function saveSettings(payload, userId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const subject = String(payload.subject).trim();
    const roomStr = String(payload.level).trim() + '/' + String(payload.room).trim();
    
    if (!checkTeacherPermission_(subject, roomStr, userId)) {
        return { success: false, message: 'ไม่อนุญาตให้ตั้งค่าสัดส่วน: วิชานี้และห้องนี้ถูกลงทะเบียนสิทธิ์โดยครูท่านอื่นแล้ว' };
    }

    const ss = getTargetDb();
    ensureSchemaAndHeaders();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SETTINGS);
    
    const term = String(sanitizeTerm_(payload.term)).trim();
    const level = String(payload.level).trim();
    const room = String(payload.room).trim();
    const ts = new Date();

    const data = sheet.getDataRange().getDisplayValues();
    let rowIndex = -1;
    for(let i=1; i<data.length; i++) {
        if(String(data[i][0]).trim() === term && 
           String(data[i][1]).trim() === subject && 
           String(data[i][2]).trim() === level && 
           String(data[i][3]).trim() === room) {
            rowIndex = i + 1; break;
        }
    }

    const rowData = [term, subject, level, room, 100, payload.wPre, payload.wMid, payload.wPost, payload.wFinal, payload.goal, ts];
    
    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, 11).setValues([rowData]);
    else sheet.appendRow(rowData);

    return { success: true };
  } catch(e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function getGradingData(filter) {
  try {
    ensureSchemaAndHeaders();
    const term = String(sanitizeTerm_(filter.term)).trim(); 
    const subject = String(normalizeSubjectCode(filter.subject)).trim();
    const level = String(filter.level).trim();
    const room = String(filter.room).trim();

    if (!subject || !level || !room) throw new Error("ระบุข้อมูลไม่ครบ (วิชา, ชั้น, ห้อง)");

    const srcDb = getSourceDb();
    const tgtDb = getTargetDb();

    const stSheet = srcDb.getSheetByName(CONFIG.SHEET_NAMES.SRC_STUDENTS);
    const students = [];
    if (stSheet && stSheet.getLastRow() > 1) {
      const vals = stSheet.getRange(2, 1, stSheet.getLastRow()-1, 11).getDisplayValues();
      vals.forEach(r => {
        const rTerm = r[10] ? String(r[10]).trim() : "";
        const rLevel = String(r[4]).trim();
        const rRoom = String(r[5]).trim();
        
        if ((rTerm === "" || rTerm === term) && rLevel === level && rRoom === room) {
          students.push({
            id: String(r[0]).trim(), prefix: String(r[1]).trim(), first: String(r[2]).trim(), last: String(r[3]).trim(), no: String(r[6]).trim(), status: String(r[7]).trim()
          });
        }
      });
    }
    students.sort((a, b) => (parseInt(a.no)||0) - (parseInt(b.no)||0));

    const asnSheet = srcDb.getSheetByName(CONFIG.SHEET_NAMES.SRC_ASSIGNMENTS);
    const scSheet = srcDb.getSheetByName(CONFIG.SHEET_NAMES.SRC_SCORES);
    
    const assignments = [];
    if (asnSheet && asnSheet.getLastRow() > 1) {
      const vals = asnSheet.getRange(2, 1, asnSheet.getLastRow() - 1, 10).getDisplayValues();
      for(let i=0; i<vals.length; i++) {
        const r = vals[i];
        const rTerm = r[6] ? String(r[6]).trim() : "";
        const rSubj = String(normalizeSubjectCode(r[3])).trim();
        if (rTerm === term && rSubj === subject) {
             const rLevel = String(r[8]||"").trim();
             const rRoom = String(r[9]||"").trim();
             if ((rLevel === "" || rLevel === level) && (rRoom === "" || rRoom === room)) {
                 assignments.push({ id: String(r[0]).trim(), title: String(r[1]).trim(), maxScore: Number(r[2]), type: String(r[4]).trim() });
             }
        }
      }
    }

    const rawScores = {};
    if (scSheet && scSheet.getLastRow() > 1) {
      const vals = scSheet.getRange(2, 1, scSheet.getLastRow() - 1, 6).getDisplayValues();
      for(let i=0; i<vals.length; i++) {
        const r = vals[i];
        const rTerm = r[5] ? String(r[5]).trim() : "";
        const asnId = String(r[1]).trim();
        
        if (rTerm === term) {
            rawScores[`${asnId}_${String(r[2]).trim()}`] = {
                score: r[3],
                isSubmitted: String(r[4]) === '1' || String(r[4]).toLowerCase() === 'true' || String(r[4]).toUpperCase() === 'TRUE'
            };
        }
      }
    }

    const setSheet = tgtDb.getSheetByName(CONFIG.SHEET_NAMES.SETTINGS);
    let settings = {};
    if (setSheet && setSheet.getLastRow() > 1) {
       const vals = setSheet.getRange(2, 1, setSheet.getLastRow() - 1, 11).getDisplayValues();
       
       for(let i=0; i<vals.length; i++) {
           const r = vals[i];
           if (String(r[0]).trim() === term && 
               String(r[1]).trim() === subject && 
               String(r[2]).trim() === level && 
               String(r[3]).trim() === room) {
               
               settings = { 
                   weightPre: Number(r[5]), 
                   weightMid: Number(r[6]), 
                   weightPost: Number(r[7]), 
                   weightFinal: Number(r[8]), 
                   goalPercent: Number(r[9]) 
               };
               break;
           }
       }
    }

    const exSheet = tgtDb.getSheetByName(CONFIG.SHEET_NAMES.EXAMS);
    const exams = {};
    if (exSheet && exSheet.getLastRow() > 1) {
        const vals = exSheet.getRange(2, 1, exSheet.getLastRow() - 1, 8).getDisplayValues();
        vals.forEach(r => {
            if (String(r[0]).trim() === term && String(r[1]).trim() === subject) {
                exams[String(r[2]).trim()] = { 
                    mid: r[3] !== '' ? Number(r[3]) : '', 
                    final: r[4] !== '' ? Number(r[4]) : '',
                    pre: r[6] !== '' && r[6] !== undefined ? Number(r[6]) : '',
                    post: r[7] !== '' && r[7] !== undefined ? Number(r[7]) : ''
                };
            }
        });
    }

    const adjSheet = tgtDb.getSheetByName(CONFIG.SHEET_NAMES.ADJUSTMENTS);
    const adjustments = {};
    if (adjSheet && adjSheet.getLastRow() > 1) {
        // [FIX] เปลี่ยนเป็นดึง 10 คอลัมน์ เพื่อเอาคอลัมน์ J (OldScore) มาด้วย
        const vals = adjSheet.getRange(2, 1, adjSheet.getLastRow() - 1, 10).getDisplayValues();
        vals.forEach(r => {
            if (String(r[2]).trim() === term && String(r[3]).trim() === subject) {
                const sid = String(r[4]).trim();
                if(!adjustments[sid]) adjustments[sid] = [];
                adjustments[sid].push({ 
                    id: String(r[0]).trim(),
                    timestamp: r[1], 
                    type: String(r[5]).trim(), 
                    newValue: String(r[6]).trim(), 
                    reason: String(r[7]).trim(), 
                    by: String(r[8]).trim(),
                    oldValue: r[9] !== undefined ? String(r[9]).trim() : '-'
                });
            }
        });
    }

    let overallTargetPercent = 0;
    const summaryRes = getSummaryDataForExport(term, subject, `${level}/${room}`);
    if (summaryRes && summaryRes.success) {
        overallTargetPercent = summaryRes.data.targetPercent;
    }

    // [NEW] ตรวจสอบว่าผู้ใช้ปัจจุบันถูกล็อก ไม่ให้สิทธิ์แก้ห้องนี้หรือไม่
    const isLocked = !checkTeacherPermission_(subject, `${level}/${room}`, filter.uid);

    return {
      success: true,
      data: { students, assignments, rawScores, settings, exams, adjustments, overallTargetPercent, isLocked }
    };

  } catch(e) {
    return { success: false, message: e.toString() };
  }
}