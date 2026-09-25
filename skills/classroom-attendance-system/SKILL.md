# Skill: Classroom Attendance System

## เป้าหมาย

พัฒนาระบบโดยคง UX/UI เดิม ป้องกันข้อมูลคะแนนและเช็คชื่อสูญหาย และทำให้การทำงานต่อบนเครื่องอื่นทำได้จาก repository เดียว

## ลำดับการทำงาน

1. อ่าน `PROJECT_RULES.md`, `PROJECT_HANDOFF.md` และ `Rules.md`
2. ตรวจ branch, remote, status และ commit ปัจจุบัน
3. วิเคราะห์ data flow ก่อนแก้โค้ด: UI → auth → API → database → cache/queue
4. แก้ source ที่ root เท่านั้น แล้ว build ไป `docs/`
5. รัน safety check, syntax check และ smoke test
6. ตรวจ diff และ commit เฉพาะไฟล์ที่เกี่ยวข้อง
7. deploy แล้วทดสอบผ่านหน้าเว็บจริง
8. บันทึกผลทดสอบและงานค้างใน handoff

## ห้ามทำ

- ห้ามเดา schema จาก label ที่แสดงผล
- ห้ามใช้ timestamp เป็น TermID
- ห้ามอ่านข้อมูลทั้งฐานเพื่อเติม dropdown ที่ต้องการเพียงเทอมเดียว
- ห้ามเขียน Firebase/Supabase/Sheets จริงระหว่างวิเคราะห์โดยไม่มีคำสั่ง
- ห้ามอ้างว่าเสร็จจากการ build โดยไม่ทดสอบ login และหน้าคะแนน

## Definition of done

- login สำเร็จและคง session หลัง reload
- ทุก query มี term/class scope
- CRUD คะแนนและเช็คชื่ออ่าน/เขียน/refresh ได้โดยข้อมูลไม่หาย
- มี backup และ checksum ก่อน migration
- test และ build ผ่าน
- browser smoke test ผ่านทุกแท็บที่เกี่ยวข้อง
