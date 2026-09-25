# Classroom Attendance 2569 — Project Handoff / Rules

เอกสารนี้เป็นจุดเริ่มต้นสำหรับทำงานต่อบนเครื่องอื่น ห้ามถือว่างานเสร็จจนกว่าจะผ่านเกณฑ์ตรวจสอบท้ายเอกสาร

## เป้าหมายหลัก

- คง UX/UI และ flow เดิมของระบบ
- ข้อมูลที่กรอกแล้วต้องไม่หาย โดยเฉพาะคะแนนงานนักเรียนและการเช็คชื่อ
- ใช้ `TermID` แบบถาวร เช่น `2569_1` หรือ `2569-1` ห้ามใช้ timestamp เป็นรหัสเทอม
- ระยะเปลี่ยนผ่าน: Firebase ยังเป็นแหล่งข้อมูลจริงจนกว่าจะตรวจสอบ Supabase เทียบครบทุกจุด
- ห้ามกลับไปใช้ Google Sheets เป็นฐานข้อมูล runtime

## Repository / Deploy

- Git remote: `https://github.com/suradettwrk-commits/classroom-attendance-2569.git`
- Branch หลัก: `main`
- Production URL: `https://suradettwrk-commits.github.io/classroom-attendance-2569/`
- GitHub Pages deploy จากโฟลเดอร์ `docs/`
- Source workspace สำหรับพัฒนาคือโฟลเดอร์ root นี้ ไม่ควรแก้ไฟล์ใน `docs/` ด้วยมือ

Build Pages หลังแก้ source:

```bash
/Users/edward/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node build-github-pages.js
git add .
git commit -m "describe the change"
git push origin main
```

หากเปลี่ยนเครื่อง ให้ใช้ Node ที่ติดตั้งในเครื่องแทน path ข้างต้น และตรวจว่า `build-github-pages.js` ทำงานสำเร็จก่อน commit

## สถาปัตยกรรมปัจจุบัน

1. GitHub Pages เป็น frontend/static host
2. Supabase Auth เป็นทิศทางหลักของการยืนยันตัวตน Google ด้วย PKCE
3. `supabase/functions/score-api/index.ts` เป็น API สำหรับข้อมูลคะแนนและ dashboard ที่ปรับ query ให้ scope ตามเทอม
4. Firebase compatibility bridge ยังมีอยู่เพื่อคงการทำงานเดิมและเป็นแหล่งข้อมูลจริงระหว่างตรวจสอบความตรงกัน
5. Google Apps Script compatibility layer ยังมีบาง flow เก่า ห้ามลบจนกว่าจะย้ายและทดสอบครบ
6. Google Sheets ห้ามถูกเรียกใน runtime ใหม่ และห้ามเขียนข้อมูลจริงระหว่างการตรวจสอบ

## สิ่งที่แก้แล้ว

- ใช้ query แบบ explicit และ scope ตาม `TermID` ใน score API
- แก้การโหลด bootstrap ให้โหลด terms ก่อน แล้วค่อยโหลด subject/student/assignment/class ของเทอมที่เลือก
- เพิ่ม allowlist อีเมลเจ้าหน้าที่ในฝั่ง API
- เพิ่ม Supabase Auth bridge แบบ REST + PKCE ใน `supabase-auth-client.js`
- เก็บ PKCE verifier ใน sessionStorage และ localStorage fallback เพื่อรองรับ static redirect
- ป้องกันการแลกเปลี่ยน OAuth code ซ้ำด้วยการ reuse `__SUPABASE_AUTH_READY`
- เริ่มเปลี่ยนจุดตรวจสิทธิ์ครู/แอดมินใน `admin.html` และ `firebase-bridge.js` ให้รับ Supabase identity

## Commit สำคัญ

- `6911dab` — persist PKCE verifier across OAuth redirect
- `4c89c16` — prevent duplicate Supabase PKCE callback exchange
- `20c1fa8` — use Supabase identity for staff access checks (มีในเครื่องพัฒนา แต่ต้องตรวจว่า push ขึ้น remote แล้ว)

## งานค้างที่ต้องทำต่อ

1. ตรวจว่า `20c1fa8` ขึ้น `origin/main` แล้ว
2. ทดสอบ Google login ด้วยบัญชีที่อนุญาต และยืนยันว่าไม่กลับหน้า login
3. ตรวจ server profile lookup ว่าคืนข้อมูลครู/แอดมินจากอีเมล Supabase ได้จริง
4. เข้าแท็บ `ส่งงาน/คะแนน` แล้วตรวจว่า term, subject, level, room, students และ assignments โหลดครบ
5. ทดสอบ CRUD ด้วยข้อมูลทดสอบเท่านั้น: create, read, update, delete/soft-delete และ refresh ข้ามวัน
6. ตรวจว่า score write ไปแหล่งข้อมูลที่กำหนดเพียงจุดเดียว และไม่มีการเขียน Sheet
7. เปรียบเทียบ Firebase กับ Supabase แบบ read-only ทุกตาราง/ฟิลด์ที่ใช้จริงก่อนย้าย source of truth
8. ทำ backup/export ก่อนทุก migration และเก็บ manifest จำนวนแถวกับ checksum ไว้
9. เมื่อผ่านการเทียบข้อมูลและ CRUD ทุกแท็บแล้วจึงค่อยวางแผนถอด Firebase compatibility bridge

## กฎความปลอดภัยข้อมูล

- ห้ามลบ แก้ หรือ migrate ข้อมูลจริงโดยไม่มี backup ที่ตรวจเปิดอ่านได้
- ห้ามใช้ `git reset --hard`, `git checkout --` หรือคำสั่งลบแบบกว้าง
- ห้าม commit secrets, service-role key, OAuth client secret, access token หรือข้อมูลนักเรียน
- ห้ามแสดง token/code จาก OAuth ใน log หรือคำตอบ
- การทดสอบคะแนนจริงต้องเป็น read-only จนกว่าจะมีคำสั่งให้เขียนข้อมูล
- ก่อน deploy ทุกครั้งตรวจ `git diff`, `git status`, และ commit ที่จะส่ง

## เกณฑ์พร้อมใช้งานจริง

ระบบจะถือว่าเสร็จเมื่อครบทุกข้อ:

- Google login ผ่านและคง session หลัง reload/เปิดวันถัดไป
- หน้า dashboard และทุกแท็บไม่แสดงข้อมูลเป็น 0 เพราะ query/auth race
- term ใช้ ID ถาวร ไม่ใช่วันที่ timestamp
- ครูหลายคนเห็นเฉพาะข้อมูลตามสิทธิ์ของตน
- กรอก/แก้/อ่านคะแนนได้ต่อเนื่อง และข้อมูลไม่หายหลัง refresh หรือเปิดเครื่องใหม่
- CRUD ทุก flow มีผลตรงกันใน UI, API และฐานข้อมูลกลาง
- ไม่มี runtime read/write ไป Google Sheets
- backup ล่าสุด restore ตรวจสอบได้
- Firebase และ Supabase ผ่านการเปรียบเทียบข้อมูลครบก่อนถอด Firebase

## วิธีเริ่มงานบนเครื่องใหม่

```bash
git clone https://github.com/suradettwrk-commits/classroom-attendance-2569.git
cd classroom-attendance-2569
git log -5 --oneline
git status
```

อ่านไฟล์นี้ก่อนแก้โค้ด จากนั้นตรวจ `supabase/functions/score-api/index.ts`, `supabase-auth-client.js`, `firebase-bridge.js`, `admin.html` และ `index.html` ตามลำดับ ห้ามสรุปว่า deploy สำเร็จจาก commit อย่างเดียว ต้องเปิด production URL และทดสอบ flow จริงด้วย

## สถานะ ณ วันที่ 2026-09-25

- ไม่ได้ลบหรือแก้ข้อมูลจริงใน Firebase, Supabase หรือ Google Sheets
- Firebase ยังถือเป็นแหล่งข้อมูลจริงชั่วคราว
- Commit ล่าสุดในเครื่องคือ `20c1fa8`
- ต้องตรวจ remote และ deploy หลังจาก commit นี้ก่อนดำเนินการทดสอบต่อ
