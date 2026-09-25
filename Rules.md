# Production Rules — classroom-attendance-2569

ไฟล์นี้เป็นกติกาบังคับก่อน `deploy` ทุกครั้ง ต้องอ่านจบก่อน deploy เสมอ

## ขอบเขตห้ามแตะ

- โปรเจกต์ปลายทางเท่านั้น: Firebase `classroom-attendance-2569`, Hosting `classroom-attendance-2569.web.app`, GitHub `suradett-max/classroom-attendance-2569`
- ห้ามลบ แทนที่ หรือเขียนทับข้อมูลใน `students`, `assignments`, `scores`, `attendance`, `terms`, `teacherClasses`
- ห้ามใช้ migration ที่เขียนข้อมูลจริงเป็นส่วนหนึ่งของ Hosting deploy
- ห้ามใช้ `set()` กับคะแนนเดิมเพื่อเติม schema ใหม่ หากไม่ได้อ่านข้อมูลเดิมมา merge ก่อน
- ห้ามเปลี่ยน `StudentID`, `AssignmentID`, `ScoreID`, `RecordID` หรือค่า `Score` เดิม
- การเปลี่ยนสถานะนักเรียนต้องแก้เฉพาะ `Status` และ field metadata ที่ว่างเท่านั้น

## สัญญา ID ใหม่

- `TermID` คือรหัสภาคเรียนถาวร ไม่ใช้ข้อความวันที่หรือ label ที่แสดงผลแทนกัน
- `ClassID` คือขอบเขต `TermID + Level + Room` เช่น `CLASS_TERM_2569_1_ม.2_9`
- `TeacherClassID` คือขอบเขตครู + วิชา + ห้อง + ภาคเรียน
- `StudentID`, `AssignmentID`, `ScoreID`, `RecordID` เป็น primary key ของตนเองและห้ามเปลี่ยน
- `scores`, `assignments`, `attendance` ต้องอ้าง `TeacherClassID` และเมื่อ migration เสร็จต้องมี `ClassID`/`TermID` ด้วย
- `students` ใช้ `ClassID` เป็นขอบเขตห้อง ไม่ผูกกับวิชาใดวิชาหนึ่ง เพราะนักเรียนหนึ่งคนอาจมีหลาย `TeacherClassID`

## หลักการ compatibility

ข้อมูลเก่าที่ไม่มี ID ใหม่ต้องอ่านได้และเขียนต่อได้ด้วยกติกา legacy ที่จำกัดขอบเขตเท่านั้น การแปลงชนิด `Room`/`Level` เป็นข้อความเป็นเพียงสะพานชั่วคราว ไม่ใช่ schema หลัก และห้ามสร้างกติกาเทียบข้อมูลแบบ ad-hoc เพิ่มอีก

ลำดับการอ่านของโค้ดใหม่คือ:

1. ใช้ `ClassID`/`TermID`/`TeacherClassID` ก่อน
2. ถ้าไม่มี ให้ใช้ข้อมูล legacy เพื่อแสดงผลหรือรองรับการแก้ไขเดิม
3. ห้ามเดา ID จากชื่ออย่างเดียวถ้ามี ID อยู่แล้ว

## สถานะนักเรียนและคิวซิงก์

- การเปลี่ยนสถานะนักเรียนใช้คำขอ/คิว `STUDENT_STATUS` แยกจากคิว `SCORE` และ `GRADING`
- งาน `STUDENT_STATUS` ต้องแก้เฉพาะ `Status` โดยใช้ `StudentID` เดิม และเก็บ payload ไว้จนกว่าจะยืนยันผลจาก Firebase
- ห้ามนำคิวสถานะนักเรียนไปรวมกับการบันทึกคะแนนงานหรือคะแนนตัดเกรดที่ทำงานปกติอยู่แล้ว
- แท็บคะแนนงานและตัดเกรดอ่าน `students.Status` จาก Firebase แบบเรียลไทม์ แสดง badge ลาออกแล้ว และปิดช่องแก้ไข โดยไม่ลบคะแนนเดิม
- คิวเขียน `SCORE`, `ATTENDANCE`, `STUDENT_STATUS` และงานที่แก้ข้อมูลต้องรอ Firebase Auth ที่ยืนยันอีเมลตรงกับ `CURRENT_USER` ก่อนส่ง ห้ามส่งผ่าน anonymous session
- Realtime listener ของคะแนนงานและตัดเกรดต้องมี timeout ที่แน่นอนและต้องถอด listener เมื่อผิดพลาด ห้ามปล่อยหน้าหมุนไม่สิ้นสุด
- เมื่อ realtime bootstrap ไม่จบ ให้ใช้ one-shot read จาก Firebase เป็น fallback แบบมี timeout แล้วแสดงปุ่มโหลดใหม่ โดยห้ามเขียน ลบ หรือใช้ข้อมูล fallback ไปแทนคะแนนที่ผู้ใช้กรอกค้างไว้

## ก่อน deploy

1. ตรวจ `git status`, branch และ remote ให้เป็น repo nested นี้เท่านั้น
2. ตรวจว่าไฟล์สำรองล่าสุดอยู่ใน `scratch/backup-pre-canonical-id-20260922/` หรือสร้างชุดใหม่ก่อนแก้
3. รัน `node --check firebase-bridge.js`
4. รัน `node -e "JSON.parse(require('fs').readFileSync('firebase-rtdb.rules.json','utf8')); console.log('rules json ok')"`
5. รัน `powershell -ExecutionPolicy Bypass -File scripts/audit-canonical-ids.ps1` แบบอ่านอย่างเดียว
6. สร้าง `docs/index.html` ด้วย `node build-github-pages.js` แล้วตรวจว่า `docs/firebase-bridge.js` ตรงกับ root
7. ตรวจ diff ว่าไม่มีไฟล์ `scratch/`, xlsx, `รหัส.gs` หรือข้อมูล production ถูก stage โดยไม่เกี่ยวข้อง
8. ทดสอบอย่างน้อย: เปิดห้องเดิม, เปลี่ยนห้อง, reload, หน้า งานคะแนน, หน้า เช็คชื่อ, หน้า ตัดเกรด
9. deploy เฉพาะโปรเจกต์นี้ และเก็บ commit/deploy output ไว้ในบันทึกงาน

## หลัง deploy

- เปิด URL จริงด้วย query ใหม่หรือ hard refresh
- ตรวจว่ารายชื่อ/งาน/คะแนน/เช็คชื่อ/ตัดเกรดมาจาก Firebase เดียวกันและไม่มีค่าเป็น 0 จากการอ่านผิด scope
- ตรวจนักเรียนสถานะ `ลาออกแล้ว` ว่าแสดง badge และถูก lock ในงานคะแนน/ตัดเกรด โดยข้อมูลเดิมยังอ่านได้
- ตรวจ browser console และ Firebase error ต้องไม่มี `PERMISSION_DENIED`, `authz is not defined`, timeout หรือรายการ sync ค้าง
- หาก Auth ยังไม่พร้อม ให้แสดง `รอยืนยันบัญชี` แทน `กำลังบันทึก` และห้ามนับว่าเป็นการส่งข้อมูลสำเร็จ
- ห้ามสรุปว่าเสร็จจากผล build/deploy อย่างเดียว ต้องมี browser smoke test ด้วย

## Migration production ที่ยังไม่อนุญาตให้รันอัตโนมัติ

การเติม `ClassID`/`TermID` ให้ข้อมูลเดิมเป็นงานแยก ต้อง backup/export และตรวจรายงาน mapping ก่อนเสมอ การ migration ต้องเป็น additive-only, merge เฉพาะ field ที่ขาด, ไม่แก้ `Score`, ไม่ลบ record และมีรายงานจำนวน success/skip/conflict ให้ตรวจ ก่อนจึงจะมีสิทธิ์ใช้คำสั่งเขียนจริง

หากพบ conflict ให้หยุดและเก็บรายการ conflict ไว้ตรวจ ไม่ใช้ fallback เดาชื่อห้องหรือภาคเรียนเพื่อเขียนทับข้อมูล

## Rollback

Rollback ได้เฉพาะ source/rules ผ่าน Git commit ที่ตรวจแล้ว ห้าม restore database ทั้งก้อนทับ production เพื่อแก้ปัญหา UI เพราะอาจย้อนคะแนนใหม่และข้อมูลเช็คชื่อที่เพิ่งกรอก หากต้องกู้ข้อมูลจริงต้องระบุ path, ช่วงเวลา และได้รับอนุมัติก่อนทุกครั้ง
