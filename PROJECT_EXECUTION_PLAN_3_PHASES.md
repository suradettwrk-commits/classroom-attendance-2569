# แผนดำเนินงานระบบจัดการชั้นเรียน 3 ระยะ

เอกสารนี้เป็นแผนหลักสำหรับตรวจ เตรียม แก้ไข ทดสอบ และส่งระบบขึ้นใช้งานจริง โดยรวมงานเดิมให้เหลือ 3 ระยะ

## หลักการความปลอดภัย

- Firebase `classroom-attendance-2569` ยังเป็นแหล่งข้อมูลจริงจนกว่าจะตรวจสอบข้อมูลครบถ้วน
- ห้ามลบ แทนที่ หรือเขียนทับข้อมูล `students`, `assignments`, `scores`, `attendance`, `terms` และ `teacherClasses` โดยไม่ได้รับการยืนยัน
- ห้ามใช้ Timestamp เป็น `TermID`
- ห้าม migration หรือเขียนข้อมูลจริงระหว่างการ deploy Hosting
- ห้ามใช้ anonymous session สำหรับการเขียนข้อมูล
- ห้ามนำ backup, token, secret, `.env` หรือข้อมูลนักเรียนขึ้น Git
- หากพบ checksum ไม่ตรง, mapping conflict, orphan ที่ยังอธิบายไม่ได้ หรือข้อมูลผิดขอบเขต ให้หยุดงานทันที

## ระยะที่ 1: ตรวจและเตรียม

### เป้าหมาย

ยืนยัน backup, กฎ, Git, โครงสร้างข้อมูล และสถานะระบบก่อนแก้ไข โดยยังไม่เขียนข้อมูลจริงและยังไม่ deploy

### งานที่ทำพร้อมกันได้

#### 1. ตรวจ backup

- ตรวจไฟล์ Firebase data, Firebase Rules, Git backup และ manifest
- ตรวจขนาด วันเวลา และรูปแบบ JSON
- ตรวจ SHA-256 ของ Firebase backup
- ตรวจจำนวนข้อมูลในแต่ละ path

ค่าที่ต้องตรวจ:

```text
Firebase backup: 49 MB
Git backup: 518 KB
Firebase Rules: 14 KB
SHA-256:
879d2fcf0cd491079adccec8642f6b7e46109390f1a25e4e0e7da7c43027f2ab
```

คำสั่งตรวจ checksum:

```bash
shasum -a 256 _BACKUP_FIREBASE_LIVE_20260925_1030.json
```

#### 2. ตรวจ Git และเอกสาร

- ตรวจ branch, remote, commit และ working tree
- ตรวจไฟล์ staged, modified และ untracked
- ตรวจว่า backup ถูก `.gitignore`
- ค้นหาและอ่าน `PROJECT_RULES.md`, `PROJECT_HANDOFF.md` และ `GEMINI_GRAVITY_PROMPT.md`
- หากไม่พบ ให้ใช้ `Rules.md` เป็นกฎอ้างอิงชั่วคราวและบันทึกข้อจำกัดไว้

#### 3. ตรวจฐานข้อมูลต้นทางแบบ Read-only

ตรวจ Firebase paths ต่อไปนี้:

- `students`
- `assignments`
- `scores`
- `attendance`
- `terms`
- `teacherClasses`
- `subjects`
- `users`

ตรวจรายการต่อไปนี้:

- duplicate IDs
- คะแนนที่ไม่มีนักเรียน
- คะแนนที่ไม่มีงาน
- งานที่ไม่มีวิชา
- ข้อมูลที่ไม่มีเทอม
- ค่า `TermID`, `ClassID` และ `TeacherClassID`
- ความถูกต้องของข้อมูล legacy

#### 4. ตรวจ Supabase แบบ Read-only

- ตรวจ Project ref เดิม `jvyxnsokfpnepshyyzpg`
- ตรวจ tables, columns, primary keys, foreign keys และ RLS
- ตรวจจำนวนข้อมูลและ orphan rows
- จัดทำ mapping ระหว่าง Firebase กับ Supabase
- ห้าม import, update, delete, truncate หรือ migration ในระยะนี้

### ผลลัพธ์ที่ต้องได้

- รายงาน checksum และ backup
- รายงาน Firebase แบบ Read-only
- รายงาน orphan และ duplicate
- รายงาน Term/Class/TeacherClass mapping
- รายงาน Supabase แบบ Read-only
- รายงานสถานะ Git และไฟล์ที่เกี่ยวข้อง

### เงื่อนไขผ่านระยะที่ 1

- checksum ตรง
- backup เปิดอ่านได้
- Rules เป็น JSON ที่ถูกต้อง
- ทราบ source of truth
- ทราบไฟล์ที่จะแก้ไข
- ไม่มีคำสั่งเขียนฐานข้อมูลถูกเรียก

## ระยะที่ 2: ลงมือแก้ไขและทดสอบ

### เป้าหมาย

แก้ปัญหา Login, data scope, mapping, realtime และ CRUD แล้วทดสอบด้วยข้อมูลสำรองโดยไม่แตะ Firebase จริง

### งานที่ทำพร้อมกันได้

#### 1. แก้ระบบ Auth และ Login

- แก้ Firebase Auth readiness
- แก้ Admin Google login และ profile lookup
- ตัด Student Portal และ Student login ออกจาก flow การใช้งาน
- ตรวจ `CURRENT_USER`
- แก้ logout และ session cleanup
- ป้องกัน anonymous write
- แสดงสถานะรอยืนยันบัญชีเมื่อ Auth ยังไม่พร้อม

เกณฑ์ผ่าน:

- Admin login สำเร็จ
- ไม่พบช่องทาง Student login หรือ Student Portal ในหน้าใช้งาน
- reload แล้ว session ถูกต้อง
- logout แล้วเข้าหน้าแอปต่อไม่ได้
- ไม่มีการเขียนด้วย anonymous session

#### 2. แก้ bridge และ data scope

- ใช้ `ClassID`, `TermID` และ `TeacherClassID` ก่อนข้อมูล legacy
- รองรับข้อมูลเดิมที่ยังไม่มี field ใหม่แบบจำกัดขอบเขต
- ไม่เดา ID จากชื่อเมื่อมี ID อยู่แล้ว
- แก้ realtime listener และ timeout
- ถอด listener เมื่อเกิด error
- ใช้ one-shot read เป็น fallback แบบอ่านอย่างเดียว
- ห้าม fallback เขียนทับข้อมูลที่ผู้ใช้กรอกค้างไว้
- ทำให้ `firebase-bridge.js` ใน root และ `docs` ตรงกัน

#### 3. แก้ mapping และ orphan แบบ dry-run

แบ่งผลลัพธ์เป็น:

- success
- skip
- conflict
- orphan

ห้ามเขียนจริงจนกว่าจะตรวจรายงาน mapping และ conflict เสร็จ

#### 4. ทดสอบ local ด้วย backup

ใช้ backup Firebase เป็นข้อมูลทดสอบแบบ offline โดยต้องไม่มี Firebase SDK จริงหรือ request ภายนอก

ทดสอบ Admin:

- login
- reload
- dashboard
- เปลี่ยนเทอม
- เปลี่ยนห้อง
- นักเรียน
- เช็คชื่อ
- งาน/คะแนน
- ตัดเกรด
- ตั้งค่า
- logout

ไม่ทดสอบ Student Portal เพราะระบบนี้เปิดให้ใช้งานเฉพาะครูและแอดมิน นักเรียนยังคงเป็นข้อมูลที่ครู/แอดมินจัดการในแท็บนักเรียน เช็คชื่อ คะแนน และตัดเกรด

ทดสอบ UX/UI ต้นฉบับ:

- เปรียบเทียบ layout, สี, typography, spacing และ responsive behavior กับไฟล์ต้นฉบับใน workspace
- ตรวจแถบงาน/คะแนนให้คงรูปแบบ compact เดิม
- ตรวจว่าไม่เกิด CSS override ใหม่ที่ทำให้หน้าหลักแตกต่างจากต้นฉบับโดยไม่มีเหตุผล

ทดสอบ write simulation ใน memory:

- เพิ่ม/แก้ไขนักเรียน
- เปลี่ยนสถานะลาออก
- บันทึกคะแนน
- บันทึกเช็คชื่อ
- เพิ่มงาน
- ตรวจว่าข้อมูลเดิมไม่ถูกเปลี่ยนโดยไม่ได้สั่ง

#### 5. ตรวจ CRUD และ Browser

- เปิดห้องเดิม
- เปลี่ยนห้อง
- reload
- เปิดหน้าเช็คชื่อ
- เปิดหน้างานและคะแนน
- เปิดหน้าตัดเกรด
- ตรวจ browser console
- ตรวจ timeout, permission error และข้อมูลเป็นศูนย์ผิดปกติ

### คำสั่งตรวจขั้นต่ำ

```bash
node --check firebase-bridge.js
node -e "JSON.parse(require('fs').readFileSync('firebase-rtdb.rules.json','utf8')); console.log('rules json ok')"
node build-local-test.js
```

### เงื่อนไขผ่านระยะที่ 2

- Login ครูและแอดมินผ่าน
- ไม่พบ Student Portal หรือช่องทาง Student login
- Dashboard, Attendance, Scores และ Grading ผ่าน
- Reload และ logout ผ่าน
- CRUD simulation ผ่าน
- ไม่มี JavaScript error สำคัญ
- ไม่มีข้อมูลหายหรือข้ามเทอม
- ไม่มี request ไป Firebase/Supabase ระหว่าง local test
- ไม่มี conflict ที่ยังไม่ทราบสาเหตุ

### Checkpoint ล่าสุดของระยะที่ 2 (ยังไม่ผ่าน)

- Login ครูและแอดมินผ่านใน Browser GPT local test แล้ว
- Student Portal และ Student Login ถูกนำออกจาก flow ใช้งานแล้ว
- UX หน้าคะแนนตรวจเทียบ Git baseline `52bd5d5` แล้ว และไม่มี CSS override ใหม่ที่เปลี่ยนรูปแบบหลัก
- Backup checksum ตรงและ audit แบบ read-only ผ่าน
- Orphan กลุ่ม `new_1784186137889_9knyg` ยืนยันต้นฉบับจาก historical backup แล้ว จัดทำ restore preview ไว้ แต่ยังไม่เขียน Firebase
- Orphan กลุ่ม `new_1788752362319_eiio0` ไม่พบต้นฉบับใน historical snapshots และมีแต่คะแนนว่าง จึงคงเป็น quarantine
- ระยะที่ 2 ยังไม่ผ่านจนกว่าจะมีหลักฐาน/การอนุมัติสำหรับการกู้คืน metadata และการจัดการกลุ่ม quarantine
- ห้าม migration, commit, push และ deploy ต่อไปจนกว่าระยะที่ 2 และระยะที่ 3 จะผ่านครบ

## ระยะที่ 3: มั่นใจ ตรวจสอบ ส่งงาน Commit, Push และ Deploy

### เป้าหมาย

ตรวจ final diff, สร้าง production build, commit, push, deploy และตรวจการใช้งานจริง

### 1. ตรวจ final ก่อน commit

```bash
git status
git diff --check
git diff --stat
git diff --name-only
```

ต้องไม่มีสิ่งต่อไปนี้ใน commit:

- backup Firebase
- `.env`
- token หรือ secret
- `node_modules`
- `scratch/`
- CSV ข้อมูลนักเรียน
- ข้อมูล production
- ไฟล์ชั่วคราว

ตรวจซ้ำ:

```bash
node --check firebase-bridge.js
node -e "JSON.parse(require('fs').readFileSync('firebase-rtdb.rules.json','utf8')); console.log('rules json ok')"
```

หากมี PowerShell runtime ให้รัน:

```bash
powershell -ExecutionPolicy Bypass -File scripts/audit-canonical-ids.ps1
```

#### 2. สร้างและตรวจ production build

```bash
node build-github-pages.js
```

ตรวจว่า:

- `docs/index.html` เป็น build ล่าสุด
- `docs/firebase-bridge.js` ตรงกับ root
- Firebase config เป็นของโปรเจกต์ที่ถูกต้อง
- ไม่มี Supabase secret ฝังใน frontend
- ไม่มี backup เข้าไปใน `docs`

#### 3. Commit เฉพาะไฟล์ที่ตรวจแล้ว

ห้ามใช้ `git add .` โดยไม่ตรวจไฟล์ก่อน

ตัวอย่าง:

```bash
git add index.html firebase-bridge.js docs/ firebase-rtdb.rules.json Rules.md
git commit -m "Fix authentication, data scope, and browser workflow"
```

#### 4. Push repository ที่ถูกต้อง

ตรวจ remote และ branch อีกครั้ง แล้วจึง push:

```bash
git remote -v
git branch --show-current
git push origin main
```

เก็บ commit hash และผลลัพธ์ push ไว้ในบันทึกงาน

#### 5. Deploy เฉพาะ Hosting

```bash
firebase use classroom-attendance-2569
firebase deploy --only hosting
```

ห้ามรวม migration หรือ database write ในคำสั่ง deploy

#### 6. ตรวจ Production หลัง deploy

เปิด URL จริงด้วย hard refresh หรือ query ใหม่:

```text
https://suradettwrk-commits.github.io/classroom-attendance-2569/
```

ตรวจซ้ำ:

- Admin login
- Student login
- reload
- dashboard
- เปลี่ยนเทอม
- เปลี่ยนห้อง
- เช็คชื่อ
- งาน/คะแนน
- ตัดเกรด
- นักเรียนสถานะลาออก
- queue และสถานะการบันทึก
- browser console
- Firebase errors
- `PERMISSION_DENIED`
- timeout
- ข้อมูลกลายเป็น 0 ผิดปกติ

### เงื่อนไขส่งงานสำเร็จ

- commit สำเร็จ
- push ไป repository ถูกต้อง
- deploy สำเร็จ
- production browser smoke test ผ่าน
- ไม่มีข้อมูลหายหรือเขียนผิดขอบเขต
- ไม่มี error สำคัญใน browser console
- มีบันทึก commit, deploy และผลทดสอบ

## Rollback

หาก production มีปัญหา ให้ rollback source หรือ rules ด้วย Git commit ที่ตรวจแล้วเท่านั้น

ห้าม restore Firebase ทั้งก้อนทับ production เพื่อแก้ปัญหา UI เพราะอาจย้อนคะแนนหรือเช็คชื่อใหม่ ห้ามลบหรือแก้ข้อมูลจริงโดยไม่มีการระบุ path, ช่วงเวลา และการอนุมัติ

## สรุปลำดับการทำงาน

```text
ระยะ 1 ตรวจและเตรียม
    ↓
ระยะ 2 แก้ไขและทดสอบ
    ↓
ระยะ 3 ตรวจ final → commit → push → deploy → production smoke test
```
