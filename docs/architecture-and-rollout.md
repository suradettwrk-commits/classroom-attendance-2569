# Architecture and rollout contract

## Current safe architecture

- GitHub repository เป็น source ของโค้ดและเอกสาร
- Hosting ใช้ workflow ที่มีอยู่จนกว่าจะอนุมัติการเปลี่ยน host
- Supabase Auth เป็น auth path ใหม่ที่กำลังตรวจสอบ
- Supabase Edge Function เป็น API path สำหรับ score/dashboard
- Firebase Realtime Database เป็น source of truth ชั่วคราว
- local cache/queue เป็น resilience layer และต้องมี namespace ตามผู้ใช้/เทอม

## Runtime rules

ทุก read ต้อง scope ด้วย `TermID` และใช้ `ClassID`/`TeacherClassID` เมื่อเกี่ยวข้องกับสิทธิ์ครู ห้ามโหลดข้อมูลทั้ง node เพื่อสร้าง dropdown หรือ dashboard

ทุก write ต้องตรวจ identity, role, scope และ idempotency ก่อนส่ง และต้องไม่ลบข้อมูลเดิมเพื่อแก้ปัญหา UI

## Rollout phases

1. Read-only comparison: Firebase vs Supabase
2. Staging CRUD ด้วยข้อมูลสำเนา
3. Shadow read และตรวจ count/checksum
4. Feature flag สำหรับอ่าน Supabase โดย rollback ไป Firebase ได้
5. Cutover หลังผ่านทุกแท็บและทุก role
6. ปิด Firebase writes ภายหลังการใช้งานนิ่งเท่านั้น
