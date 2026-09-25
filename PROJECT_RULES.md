# Project Rules — classroom-attendance-2569

อ่านไฟล์นี้ก่อนแก้โค้ดหรือ deploy ทุกครั้ง

## Source of truth และความปลอดภัย

- Firebase ยังเป็น source of truth จนกว่าการเทียบกับ Supabase จะผ่าน 100%
- Google Sheets ไม่อยู่ใน runtime และห้ามใช้เป็นฐานข้อมูลหลัก
- ห้ามลบ แก้ทับ หรือ migrate ข้อมูลจริงโดยไม่มี backup ที่ตรวจสอบได้
- ห้ามเปลี่ยน `StudentID`, `AssignmentID`, `ScoreID`, `RecordID` หรือค่า `Score` เดิม
- การทดสอบ write ใช้ข้อมูลทดสอบเท่านั้นจนกว่าจะมีคำสั่งอนุมัติ
- ห้าม commit service key, OAuth secret, access token หรือข้อมูลนักเรียน

## Canonical identifiers

- `TermID` ต้องเป็นรหัสถาวร เช่น `AY2569_T1`; UI แสดง `1/2569` ได้ แต่ห้ามใช้ label หรือ timestamp เป็น ID
- `ClassID` = ขอบเขตเทอม + ระดับ + ห้อง
- `TeacherClassID` = ครู + วิชา + ระดับ + ห้อง + เทอม
- ข้อมูล legacy อ่านได้ผ่าน compatibility layer แต่ห้ามสร้าง mapping แบบเดาเพื่อเขียนทับข้อมูล

## Data flow

```text
UI → Supabase API/Edge Function → scoped query by TermID → Firebase source of truth
                                  ↘ local cache/queue (ช่วยความลื่น ไม่ใช่ source of truth)
```

ทุก write ต้องมี idempotency key, เก็บ audit และยืนยันผลจากปลายทางก่อนนำออกจาก queue

## ก่อน deploy

```bash
node scripts/repository-safety-check.js
node --check supabase-auth-client.js
node --check supabase-score-client.js
node --check firebase-bridge.js
node build-github-pages.js
git diff --check
git status --short
```

จากนั้นตรวจ diff ว่าไม่มี backup, secret, ข้อมูล production หรือไฟล์ที่ไม่เกี่ยวข้องถูก stage

## หลัง deploy

- เปิด production URL ด้วย hard refresh
- ทดสอบ login, dashboard, ส่งงาน/คะแนน, เช็คชื่อ และตัดเกรด
- ตรวจว่า term/subject/room/student/assignment โหลดครบ ไม่กลายเป็น 0
- ตรวจ browser console และ API logs ไม่มี auth error, timeout, orphan หรือ duplicate write
- ห้ามสรุปว่าสำเร็จจาก build อย่างเดียว ต้องมี browser smoke test

## Migration policy

- schema change ต้องเป็น numbered migration ใน `supabase/migrations/`
- migration production ต้องเป็น additive-only, backup ก่อน, dry-run ก่อน และมีรายงาน count/checksum
- ห้ามรัน migration เขียนข้อมูลจริงผ่าน static deploy
- หากพบ conflict ให้หยุดและเก็บรายการ conflict ห้ามเดาหรือเขียนทับ

## Rollback

rollback source/rules ใช้ Git commit ที่ตรวจแล้ว ห้าม restore database ทั้งก้อนทับ production เพราะอาจย้อนคะแนนใหม่และเช็คชื่อใหม่
