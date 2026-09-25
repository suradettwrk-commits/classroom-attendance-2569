# Supabase migration plan

สถานะ: เตรียมแผนเท่านั้น ยังไม่สร้างโปรเจกต์และยังไม่ย้ายข้อมูลจริง

## หลักประกันข้อมูล

- Firebase Realtime Database เดิมเป็น source of truth จนกว่าจะตรวจสอบการย้ายครบ
- ห้ามลบหรือแก้ข้อมูล Firebase ระหว่าง migration
- Google Sheets เป็น legacy/backup เท่านั้น ไม่อยู่ใน runtime
- ทุก record ต้องมี stable `TermID` เช่น `AY2569_T1`
- ต้องตรวจจำนวน record และ checksum ของคะแนนก่อน/หลังย้าย โดยเฉพาะ `scores`
- ต้องมี rollback โดยสลับ feature flag กลับ Firebase ได้ทันที

## โครงสร้างปลายทาง

ตารางหลัก:

- `terms`
- `students`
- `subjects`
- `teacher_classes`
- `assignments`
- `attendance`
- `scores`
- `users`
- `auth_profiles`
- `settings`
- `audit_log`

ความสัมพันธ์สำคัญ:

```text
terms 1───* students
terms 1───* teacher_classes
teacher_classes 1───* assignments
teacher_classes 1───* attendance
assignments 1───* scores
students 1───* attendance
students 1───* scores
```

## ขั้นตอนที่ห้ามข้าม

1. ยืนยันบัญชี Git ใหม่และ Supabase organization/project ใหม่
2. สำรอง Firebase production แบบ read-only และเก็บ rules/config แยกไฟล์
3. Freeze schema ใหม่ใน Firebase และหยุดการแก้โครงสร้างระหว่าง migration
4. สร้าง Supabase schema และ RLS ผ่าน migration files ใน Git
5. Import ข้อมูลแบบ insert-only พร้อมเก็บ `legacy_firebase_key` และ `legacy_term_id`
6. ตรวจ counts, unique keys, คะแนน, attendance และ orphan records
7. ทดสอบ CRUD ใน staging โดยใช้ข้อมูลสำเนา
8. เปิด read-only comparison Firebase vs Supabase
9. cutover ด้วย feature flag และเก็บ Firebase ไว้เป็น rollback
10. เมื่อใช้งานจริงนิ่งแล้วจึงปิด Firebase writes; ห้ามลบทันที

## เกณฑ์ผ่านก่อน cutover

- จำนวน `scores` ตรง 100%
- ทุก score มี `student_id`, `assignment_id`, `term_id` ที่ resolve ได้
- ไม่มี orphan attendance/score/assignment
- checksum ของค่าคะแนนและสถานะ submission ตรงกัน
- CRUD create/update/delete ผ่าน RLS ครบทุก role
- rollback กลับ Firebase ได้โดยไม่ต้องแก้ข้อมูลผู้ใช้

## บัญชีและโควตา

การสร้าง profile ใหม่ไม่ได้แก้ปัญหา bandwidth หากแอปยังอ่านข้อมูลกว้างเกินไป จึงต้องแก้ query/listener และทำ pagination/term scoping ก่อน cutover เสมอ

