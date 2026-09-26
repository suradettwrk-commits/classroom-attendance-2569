# Phase Checkpoint Report — 2026-09-26

สถานะนี้เป็น checkpoint ของการทำงานตาม `Rules.md` และ `PROJECT_EXECUTION_PLAN_3_PHASES.md` ณ วันที่ 26 กันยายน 2569 (Asia/Bangkok)

## Supabase read-only audit checkpoint (เพิ่มเติม)

ตรวจปลายทางผ่าน Supabase Dashboard แบบ read-only แล้วเมื่อ 26 กันยายน 2569

- Project ref: `jvyxnsokfpnepshyyzpg`
- ตารางหลัก 11 ตารางเปิดใช้งาน RLS และมีข้อมูลแล้ว
- จำนวนข้อมูลหลักตรงกับ Firebase backup: students 3,152, assignments 88, scores 3,528, attendance 803, terms 1, teacher_classes 55, subjects 6, app_users 7
- ไม่พบ orphan student ใน scores, ไม่พบ orphan student ใน attendance, ไม่พบ orphan term และไม่พบ orphan teacher class ใน assignments
- พบ orphan scores 97 รายการ ซึ่งเป็นข้อมูลจากงาน 2 กลุ่ม (`new_1784186137889_9knyg`, `new_1788752362319_eiio0`) และยังต้องทำ mapping ด้วยหลักฐานก่อนแก้ไข
- RLS policy ปัจจุบันเป็น `authenticated / ALL / true` รายตาราง จึงยังไม่ใช่ policy สำหรับ production ที่จำกัดตามบทบาท
- Schema ปัจจุบันยังไม่มี foreign key บังคับ `scores.assignment_id` ไปยัง `assignments.assignment_id`; ห้ามตัดระบบจนกว่าจะออกแบบ constraint และแก้ orphan อย่างปลอดภัย
- โค้ด frontend ปัจจุบันยังไม่มี Supabase runtime adapter/config และยังเรียก Firebase bridge อยู่ จึงยังไม่ใช่การ cutover จริง
- เพิ่ม Supabase compatibility/auth layer ใน source และเปลี่ยน `build-github-pages.js` ให้ build production ใช้ Supabase client + publishable key โดยไม่โหลด Firebase SDK หรือเชื่อม Firebase RTDB
- เพิ่ม redirect URLs สำหรับการทดสอบ `http://localhost:4173/**` และ `http://localhost:4174/**` ใน Supabase Auth; Site URL production เดิมยังคงอยู่จนกว่าจะยืนยันปลายทางใหม่
- ใช้ RLS production policy บน Supabase แล้ว โดยให้เฉพาะ `authenticated` ที่เป็น staff ใน `app_users` อ่าน/เขียนได้; ไม่ได้แก้ข้อมูลในตาราง
- ตรวจนับหลังใช้ RLS แล้วข้อมูลยังตรงกับ backup: students 3,152; assignments 88; scores 3,528; attendance 803; teacher_classes 55; subjects 6; app_users 7; terms 1
- OAuth ทดสอบถึงขั้น Google ส่ง `access_token` กลับ localhost ได้แล้ว แต่ browser app ยังไม่เปิด dashboard อัตโนมัติหลัง callback จึงยังไม่ผ่าน full CRUD/browser acceptance
- ยังไม่ push/deploy จนกว่าจะปิด callback/login และทดสอบการอ่าน/เขียนทุกแท็บ รวมถึงตัดสินใจ orphan scores 97 รายการโดยไม่เดา mapping

สถานะ checkpoint: **ยังไม่ผ่านเงื่อนไข migration/cutover** และไม่มีการเขียน/ลบข้อมูล Firebase หรือ Supabase ในการตรวจรอบนี้

## สถานะสรุป

- Phase 1: ตรวจสอบแล้ว แต่ยัง **ไม่ผ่านเงื่อนไขสำหรับ migration** เพราะพบข้อมูลคุณภาพต่ำและยังไม่มีสิทธิ์/ข้อมูลสำหรับ Supabase read-only audit
- Phase 2: **ผ่านในส่วน staff-only flow และ local browser smoke test หลัก**
- Phase 3: **ยังไม่เริ่ม** — ไม่มี commit, push, deploy หรือ production migration

## Phase 1 — Read-only audit

ตรวจ backup แบบอ่านอย่างเดียวจาก `_BACKUP_FIREBASE_LIVE_20260925_1030.json` แล้ว ไม่ได้แก้ไขหรือเขียนกลับ Firebase

| รายการ | ผล |
|---|---|
| Live backup SHA-256 | PASS — `879d2fcf0cd491079adccec8642f6b7e46109390f1a25e4e0e7da7c43027f2ab` |
| Rules backup SHA-256 | PASS — `2d5aeb35d8c772856e38191aa825114a4cae41383713e9a96a4a93d41fab53f4` |
| Git backup SHA-256 | PASS — `7c5edf80ed39f99d7a7074fe89b221e55a1eeaf40efc422d6c23d527b9b9719d` |
| JSON/rules syntax | PASS |
| Duplicate primary IDs | ไม่พบในชุดข้อมูลหลักที่ตรวจ |
| Score issues | 101 รายการ: missing-assignment 97 และ grade-component 4 |
| Score mapping dry-run | พบ conflict แบบมี candidate หลายรายการ จึงยังห้ามเขียน migration |
| Canonical IDs | ยังไม่ครบ: teacherClasses ขาด primary ID 33 แถว; students/assignments/scores/attendance ยังใช้ legacy Term หรือขาด canonical fields จำนวนมาก |
| Timestamp-like term | พบค่า Term/TermID ลักษณะ timestamp ในข้อมูลเดิม ต้องจัดทำ mapping report ก่อน |
| Supabase audit | ยังทำไม่ได้: ไม่พบ credential/config ที่อนุญาตให้อ่าน และไม่มีการเชื่อมต่อ project แบบ read-only |
| Live canonical audit | ยังไม่ยืนยัน: PowerShell ไม่มีใน environment และ Firebase CLI มี error ระหว่างเรียกใช้งาน live audit |

Counts จาก backup: students 3,152; assignments 88; scores 3,528; attendance 803; terms 1; teacherClasses 55; subjects 6; users 7

## Phase 2 — Staff-only flow and local tests

การแก้ไขที่ทำไว้:

- Login entry point เหลือ Google login สำหรับครู/แอดมินเท่านั้น; ไม่ inject `student.html` และไม่รับ student credential login
- จำกัด role ที่เปิดหน้า app เป็น `admin` และ `teacher`; unauthorized Google identity ถูก sign out ทันที
- Logout ของ staff เรียก Firebase sign out และตรวจซ้ำหลัง reload
- เพิ่ม/ปรับ local harness ให้ใช้ synthetic fixture ที่ไม่มีข้อมูลส่วนบุคคล และไม่ใช้ backup จริงเป็น web fixture ที่เปิดให้ browser
- แก้ `.gitignore` ให้กัน `node_modules`, `.firebase`, `.env`, zip และ backup artifacts
- rebuild `docs/index.html` และตรวจว่า `docs/firebase-bridge.js` ตรงกับ source bridge

ผล browser smoke test ที่ตรวจแล้ว:

- Admin Google login/dashboard: PASS
- Teacher Google login/dashboard: PASS
- Teacher ไม่เห็นเมนูตั้งค่าระบบ: PASS
- Staff ไม่พบ student login form/portal ใน entry point: PASS
- Attendance roster: PASS — synthetic fixture แสดง 2 คน และป้องกันการแก้ไขแถวนักเรียนที่ลาออกแล้ว
- Scores: PASS — แสดง 1 งาน, 2 นักเรียน และสถานะนักเรียนที่ลาออกแล้ว
- Grading: PASS ใน admin flow — แสดงนักเรียน/งานและป้องกันการกรอกข้อมูลแถว inactive
- Logout และ reload แล้วกลับหน้า login: PASS

หมายเหตุ: local harness มีจังหวะ bootstrap ของ hidden term field ที่ทำให้แท็บ roster ต้องรอ/refresh เพิ่มในบางรอบ; ไม่ได้ใช้ผลนี้ตัดสิน production data และไม่ใช่เหตุผลให้ทำ migration ต่อ

## Checks ที่ทำซ้ำล่าสุด

- `node --check firebase-bridge.js`
- `node --check build-local-test.js`
- `node --check local-test-ui.js`
- `node --check local-test-firebase.js`
- parse `firebase-rtdb.rules.json`
- `cmp -s firebase-bridge.js docs/firebase-bridge.js`
- rebuild `docs/index.html`

## สิ่งที่ต้องทำก่อน Phase 3

1. จัดทำ conflict/mapping report ของ 101 score issues และ canonical ID/Term ทั้งหมด โดยห้าม write จนกว่าจะอนุมัติ mapping
2. จัดหา read-only access สำหรับ Supabase audit หรือบันทึกข้อยกเว้นอย่างเป็นทางการ
3. แก้/ยืนยัน source ของ teacherClasses ที่ขาด primary ID และ Term ที่เป็น timestamp-like
4. ทดสอบ production Firebase Auth/Rules ใน browser จริงหลัง checkpoint ข้อมูลผ่านแล้ว
5. เมื่อทุก checkpoint ผ่านเท่านั้น จึงค่อยพิจารณา Phase 3 ตามคำสั่งใหม่ของผู้ใช้
