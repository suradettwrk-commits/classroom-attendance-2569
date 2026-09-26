# Assignment Restore Preview

เอกสารนี้เป็น preview เท่านั้น ไม่มีคำสั่งเขียน Firebase และไม่ใช่ migration

## รายการที่ยืนยันจาก historical backup

Path ที่คาดว่าจะกู้คืน:

```text
assignments/new_1784186137889_9knyg
```

ข้อมูลที่จะกู้คืน:

```json
{
  "AssignmentID": "new_1784186137889_9knyg",
  "DateCreated": "2026-07-16T07:15:45.940Z",
  "DueDate": "2026-07-15T16:59:56.000Z",
  "Level": "ม.2",
  "MaxScore": 5,
  "Room": 10,
  "SubjectCode": "ส22102",
  "Term": "2568-12-31T16:59:56.000Z",
  "Title": "ใบงาน น.5-9:::ใบงานที่ 5-9",
  "Type": "Check"
}
```

เหตุผลที่ยืนยันได้:

- พบ record เดียวกันใน historical snapshots หลายชุด
- คะแนน orphan ใช้ `AssignmentID` เดียวกัน
- วันที่สร้างงานตรงกับ timestamp ของคะแนนชุดที่มีคะแนนจริง
- จึงควรกู้คืน assignment เดิม ไม่ควรเปลี่ยน `AssignmentID` ของ score

## รายการที่ยังไม่แก้

```text
new_1788752362319_eiio0
```

รายการนี้ยังไม่มี assignment ต้นฉบับใน snapshots ที่ตรวจพบ และมีแต่คะแนนว่าง 40 แถว จึงคงเป็น quarantine ต่อไปจนกว่าจะพบหลักฐานใหม่

## เงื่อนไขก่อนเขียนจริง

- ตรวจ Firebase live ว่า path นี้ยังไม่มี record ปัจจุบัน
- เปรียบเทียบ backup checksum และ field ทุกตัว
- สำรองข้อมูล live ล่าสุดอีกครั้ง
- ขออนุมัติการเขียน metadata รายการเดียว
- หลังเขียนอ่านกลับและตรวจว่า scores เดิมไม่ถูกแก้

จนกว่าจะผ่านเงื่อนไขข้างต้น ห้ามเรียก `set`, `update`, migration, commit, push หรือ deploy
