# System specification: classroom management 2569

## เป้าหมาย

ระบบเป็น staff-facing classroom operations system สำหรับครูและผู้ดูแลโรงเรียน โดยให้ข้อมูลนักเรียน งาน คะแนน การตัดเกรด และการเช็คชื่ออยู่บน active term เดียวกัน และทุกการอ่าน/เขียนต้องผ่านสิทธิ์ของผู้ใช้ปัจจุบัน

## เส้นทางข้อมูลหลัก

```text
Supabase Auth
  → verified identity/profile
  → active term / canonical term_id
  → role + teacher class scope
  → repository contract
  → CRUD adapter
  → tab UI and local durable sync queue
```

Supabase เป็น identity และ data source ของ production ส่วน Firebase-shaped bridge เป็น compatibility interface ภายในแอป ไม่ใช่แหล่งข้อมูลสำรองที่ทำงานคู่กันใน runtime

## บทบาทและขอบเขต

| Role | ขอบเขต |
|---|---|
| `admin` | จัดการระบบและข้อมูลทั้งหมดตาม policy ของบัญชีผู้ดูแล |
| `teacher` | อ่าน/เขียนเฉพาะวิชา ระดับ และห้องที่อยู่ใน `teacher_classes` ของตนใน active term |
| `attendance_assistant` | ใช้งานเฉพาะ attendance scope ที่ถูกมอบหมาย |

Production identity ต้องเป็น Google/Supabase session ที่ตรวจสอบได้ ห้ามสร้าง anonymous identity เพื่อหลบ permission failure

## Term contract

`term_id` คือ database identity หลัก ส่วน label เช่น `1/2569` เป็น presentation value เท่านั้น ทุก table ที่เป็นข้อมูลกิจกรรมต้อง resolve กลับไปยัง canonical `term_id` ก่อนอ่านหรือเขียน และ query กิจกรรมต้องเป็น term-scoped

## Data domains

- `terms`: term identity, label, status
- `students`: student identity, class, enrollment status
- `subjects`: subject catalog per term
- `teacher_classes`: permission scope ระหว่างครู/วิชา/ระดับ/ห้อง
- `assignments`: งานและคะแนนที่ผูกกับ term/class/subject
- `attendance`: วันที่/วิชา/ห้อง/นักเรียน/status/note
- `scores`: assignment/student score และ grade components
- `app_users`, `auth_profiles`: approved staff profile และ role
- `audit_log`: จุดต่อสำหรับ audit trail ของ mutation

## Functional invariants

1. Teacher ต้องไม่เห็นหรือเขียนข้อมูลนอก scope ของตน
2. เปลี่ยน term ต้องไม่ปนข้อมูลจาก term อื่น
3. เปลี่ยนวิชาใน Grading ต้อง reset และสร้าง level/room จากชุดวิชาใหม่
4. Attendance วันที่ไม่มี record ต้องยังแสดง roster จาก `students`
5. สถานะ Attendance เดิมที่กดซ้ำต้องกลายเป็นค่าว่างและ sync ได้
6. Timeout ของ read/write ต้องจบด้วย error ที่ผู้ใช้เข้าใจได้หรือ durable local queue ไม่ค้าง spinner

## Operational requirements

- backup ก่อน migration/release และเก็บคู่กับ commit SHA
- apply RLS migration และ term activity indexes ก่อน production smoke
- production smoke ต้องตรวจ Dashboard, Students, Scores, Grading และ Attendance
- เก็บ console errors, release URL, term/date/filter เมื่อเกิด incident
- ห้ามแก้ orphan score mapping แบบเดา ต้องมี dry-run, candidate mapping และ approval ก่อนเขียนจริง

## Future product hardening

ลำดับถัดไปคือ audit log สำหรับ score/attendance mutation, validation/duplicate prevention, static Tailwind build, monitoring ของ Supabase timeout/sync queue และหน้าผู้ดูแลสำหรับ backup/recovery status
