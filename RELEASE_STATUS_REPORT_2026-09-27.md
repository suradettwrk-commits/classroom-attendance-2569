# Release Status Report — 27 กันยายน 2569

## สถานะปัจจุบัน

ระบบ production อยู่ที่ commit `c380c1c` บน `origin/main` และ deploy ผ่าน GitHub Pages แล้ว

Production URL:

`https://suradettwrk-commits.github.io/classroom-attendance-2569/`

ภาพรวมการใช้งาน: **ระบบทำงานได้จริง บันทึกและซิงก์ได้จริง และมีความนิ่ง/ลื่นไหลดีมาก**

## พฤติกรรม write/sync ที่ต้องถือเป็น baseline

### Scores

- ใช้ `SYNC_ENGINE` เป็นคิวกลาง
- รวมรายการแก้ไขเป็น batch เดียว
- เก็บเฉพาะ delta ล่าสุดของแต่ละรายการ
- optimistic UI แสดงค่าทันที
- กดบันทึกแล้ว flush ทันที
- autosave ใช้ช่วง coalesce สั้นเพื่อรวมการแก้ไขรัว ๆ
- หลัง Supabase ตอบรับจะ patch cache ในเครื่อง ไม่อ่าน root ทั้งระบบซ้ำ

### Grading

- ใช้ `saveGradingBatch` pipeline ของตัวเอง ไม่เข้าคิว Scores
- มี `grading.saving`, `saveQueued`, conflict check และ retry ของตัวเอง
- บันทึกคะแนนตัดเกรดและ settings ใน batch เดียว
- settings ต้องส่ง canonical `TermID` เสมอ เพื่อไม่ให้เกิด `term_id NULL (23502)`
- หลังบันทึกสำเร็จใช้ optimistic state/cache ไม่ reload ข้อมูลทั้งชุดโดยไม่จำเป็น

การแยก pipeline ของ Grading เป็นพฤติกรรมที่ตั้งใจและเป็น baseline ปัจจุบัน ไม่ควรรวมเข้ากับ queue Scores เพียงเพื่อให้แถวสถานะเหมือนกัน เพราะอาจทำให้เกิดการรอคิว, duplicate retry, conflict ผิดจังหวะ หรือ settings ถูกเขียนไม่พร้อมคะแนน

## หลักฐาน release

- commit: `c380c1c`
- GitHub Actions: Deploy GitHub Pages ผ่าน
- Pages deployment: ผ่าน
- syntax contract: ผ่าน
- term contract: ผ่าน
- repository contract: ผ่าน
- release contract: ผ่าน
- UI regression contract: ผ่าน
- HTML embedded-script syntax: ผ่าน
- `git diff --check`: ผ่าน
- production read-only load: โหลดหน้า production ได้และไม่พบ console error/warn ในหน้า login
- ไม่มีการเขียนข้อมูลทดลองลง Supabase จริงในรอบนี้

## ข้อจำกัดที่ต้องจำ

- การตรวจ Production รอบล่าสุดยังอยู่ก่อน login จึงไม่ได้อ้างว่าได้กด save ในทุกแท็บหลัง deploy รอบนี้
- `backup-manifest.sha256` ไม่มีอยู่ใน worktree จึงรัน backup-manifest verification ไม่ได้
- ห้ามแตะ `admin.html?verify=20260927-admin` ซ้ำ
- ห้ามรวม Scores/Grading queue หรือ refactor ใหญ่ หากไม่มีคำสั่งใหม่
- ห้าม force push และห้ามนำ branch main ใน OneDrive ที่ประวัติแยกกันมาผสานทับ `origin/main`

## วิธี rollback/ตรวจย้อนหลัง

1. ตรวจ `git status`, `git log` และ `git rev-parse origin/main` ก่อนทำงานใหม่
2. baseline release ปัจจุบันคือ `c380c1c`
3. จุดก่อนหน้าโดยตรงคือ `1f5ad81`
4. หากพบ regression ให้หยุดการแก้ซ้ำก่อน เปรียบเทียบ diff ระหว่างสอง commit และรายงานอาการจริง
5. ห้าม reset หรือ checkout ทับไฟล์ผู้ใช้โดยไม่ได้รับคำสั่ง

ไฟล์ handoff หลัก: `HANDOFF_AI_NEXT.md`
