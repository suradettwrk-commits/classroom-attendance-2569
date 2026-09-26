# Production release runbook

เอกสารนี้เป็นขั้นตอนปิดงานและตรวจซ้ำสำหรับระบบจัดการชั้นเรียนที่ใช้ Supabase Auth + Supabase data layer + GitHub Pages

## ก่อน release

1. ตรวจว่า backup ล่าสุดอ่านได้ และมีไฟล์ต้นฉบับที่ระบุ `terms`, `students`, `subjects`, `teacherClasses`, `assignments`, `attendance`, `scores`
2. รัน `npm run test:syntax`
3. รัน `npm run test:term-contract`
4. รัน `npm run test:repository-contract`
5. รัน `npm run test:release-contract`
6. รัน `npm run test:ui-contract`
7. รัน `BACKUP_MANIFEST=/path/to/_BACKUP_LIVE_MANIFEST_*.sha256 npm run test:backup-manifest`
8. รัน `git diff --check`
9. ใช้ Local Test ตรวจ Attendance วันที่ไม่มีข้อมูล: roster ต้องครบ, สถานะทั้ง 4 สีต้องเปลี่ยนได้, กดสถานะเดิมซ้ำต้องเคลียร์ และ reload แล้วต้องว่าง

## Supabase migration

รัน migration `supabase/migrations/20260926_harden_staff_rls.sql` และ `supabase/migrations/20260926_add_term_activity_indexes.sql` ใน Supabase project ก่อน smoke test production เพื่อให้ RLS และ index สำหรับ term-scoped reads อยู่จริง การสร้าง index เป็นการเพิ่มประสิทธิภาพอย่างเดียว ไม่เปลี่ยนข้อมูลหรือสิทธิ์

## หลัง deploy

ตรวจด้วยบัญชีครูจริง:

- Dashboard แสดง term ปัจจุบันและไม่เกิด error ใหม่
- Scores แสดง assignments และ grid คะแนน
- Grading เปลี่ยนวิชาแล้ว level/room reset และโหลดชุดใหม่
- Students แสดง Active/ลาออก/พักการเรียนตาม filter
- Attendance โหลด roster ครบ และทดสอบ `มา → สาย → ลา → ขาด → เคลียร์`
- reload Attendance แล้วสถานะที่เคลียร์ต้องยังว่าง

## การตีความ warning

- `Dashboard stats still running` ต้องไม่เกิดก่อน 35 วินาที; ถ้าเกิดหลังจากนั้นให้ตรวจ Supabase query/RLS/index
- `SUPABASE_READ_SKIPPED:*` เป็นปัญหาจริง ไม่ควรกลบด้วยการปิด log; ตรวจ table policy, index และ statement timeout
- `DATA_CONTROLLER attendance lazy/empty` เป็น info ใน cold start ได้ แต่ต้องมี `ATT_SERVER_RESPONSE` และ roster ต้องแสดงครบ
- `cdn.tailwindcss.com` เป็น technical debt ที่ควรย้ายไป static CSS build ก่อนรอบ production hardening ถัดไป

## Recovery

ก่อน migration/release ให้เก็บ backup พร้อม timestamp และ commit SHA เดียวกัน หาก smoke test ล้มเหลวให้หยุดการ release, เก็บ console error + URL release + term/date/filter ที่ใช้, แล้ว revert application release หรือ restore database ตามสาเหตุ ห้ามลบข้อมูลเพื่อแก้ปัญหาเฉพาะหน้า

Recovery rehearsal แบบไม่แตะ production: ตรวจ checksum ด้วย `test:backup-manifest`, ตรวจ term/data contract จาก backup จริง และสร้าง Local Test ด้วย `build-local-test.js` จาก backup เดิม การ restore database จริงต้องใช้ staging project หรือ snapshot ที่แยกจาก production และต้องมีผู้รับผิดชอบอนุมัติก่อนเขียนข้อมูล
