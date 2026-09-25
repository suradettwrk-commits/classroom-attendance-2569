import { createRemoteJWKSet, jwtVerify } from "npm:jose";

const PROJECT_ID = "classroom-attendance-2569";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("MIGRATION_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://suradettwrk-commits.github.io";
const FIREBASE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const ADMIN_EMAIL = "suradet.t@wrk.ac.th";
const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const enc = (v: unknown) => encodeURIComponent(String(v ?? ""));
const text = (v: unknown) => String(v ?? "").trim();
const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  return body ? JSON.parse(body) : [];
};
const termIdFor = async (value: unknown) => {
  const raw = text(value);
  if (/^AY\d+_T\d+$/.test(raw)) return raw;
  const rows = await api(`terms?select=term_id&or=(display_label.eq.${enc(raw)},legacy_term_key.eq.${enc(raw)})&limit=1`);
  if (!rows[0]) throw new Error(`ไม่พบภาคเรียน ${raw}`);
  return rows[0].term_id;
};
async function authenticate(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("ไม่พบ Firebase Login Token");
  const verified = await jwtVerify(token, FIREBASE_JWKS, { issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID });
  const email = text(verified.payload.email).toLowerCase();
  if (email === ADMIN_EMAIL) return { admin: true, teacherId: "admin" };
  const profiles = await api(`auth_profiles?select=legacy_user_id,role,status&email=eq.${enc(email)}&limit=10`);
  const profile = profiles.find((p: any) => text(p.status).toLowerCase() === "active" && text(p.role).toLowerCase() === "teacher");
  if (!profile?.legacy_user_id) throw new Error("บัญชีครูยังไม่ได้รับอนุมัติ");
  return { admin: false, teacherId: profile.legacy_user_id };
}
async function context(body: any, auth: any) {
  const termId = await termIdFor(body.term), subjectCode = text(body.subjectCode || body.subject), level = text(body.level), room = text(body.room);
  const [termRows, students, assignments, classes] = await Promise.all([
    api(`terms?term_id=eq.${enc(termId)}&select=display_label`),
    api(`students?term_id=eq.${enc(termId)}&level=eq.${enc(level)}&room=eq.${enc(room)}&select=student_id,student_no,prefix,first_name,last_name,level,room,status`),
    api(`assignments?term_id=eq.${enc(termId)}&subject_code=eq.${enc(subjectCode)}&level=eq.${enc(level)}&room=eq.${enc(room)}&select=assignment_id,title,assignment_type,max_score,due_date,level,room,status,subject_code`),
    api(`teacher_classes?term_id=eq.${enc(termId)}&subject_code=eq.${enc(subjectCode)}&level=eq.${enc(level)}&room=eq.${enc(room)}&status=neq.inactive&select=teacher_id`)
  ]);
  if (!auth.admin && !classes.some((c: any) => text(c.teacher_id) === text(auth.teacherId))) throw new Error("ครูไม่มีสิทธิ์ในวิชา ชั้น หรือห้องนี้");
  const scores = await api(`scores?term_id=eq.${enc(termId)}&subject_code=eq.${enc(subjectCode)}&select=score_id,assignment_id,student_id,subject_code,score,is_submitted`);
  return { termId, term:termRows[0]?.display_label || text(body.term), subjectCode, level, room, students, assignments, scores };
}
function output(ctx: any) {
  const scores: Record<string, any> = {};
  for (const row of ctx.scores) scores[`${row.assignment_id}_${row.student_id}`] = { id:row.score_id, scoreId:row.score_id, assignmentId:row.assignment_id, studentId:row.student_id, score:row.score ?? "", isSubmitted:row.is_submitted ? 1 : 0, termId:ctx.termId, term:ctx.term, subjectCode:row.subject_code };
  return { success:true, data:{ term:ctx.term, termId:ctx.termId, subject:ctx.subjectCode, subjectCode:ctx.subjectCode, level:ctx.level, room:ctx.room, students:ctx.students.map((s:any)=>({id:s.student_id,studentId:s.student_id,no:s.student_no,prefix:s.prefix||"",first:s.first_name||"",last:s.last_name||"",firstName:s.first_name||"",lastName:s.last_name||"",name:[s.prefix,s.first_name,s.last_name].filter(Boolean).join(" "),level:s.level,room:s.room,status:s.status,term:ctx.term,termId:ctx.termId})), assignments:ctx.assignments.map((a:any)=>({id:a.assignment_id,assignmentId:a.assignment_id,title:a.title||"",maxScore:Number(a.max_score||0),subjectCode:a.subject_code,type:a.assignment_type||"",dueDate:a.due_date,level:a.level,room:a.room,term:ctx.term,termId:ctx.termId})), scores } };
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = await authenticate(request), body = await request.json(), action = text(body.action), ctx = await context(body, auth);
    if (action === "load") return json(output(ctx));
    if (action !== "save") throw new Error("คำสั่งไม่ถูกต้อง");
    const students = new Set(ctx.students.map((s:any)=>s.student_id)), assignments = new Set(ctx.assignments.map((a:any)=>a.assignment_id));
    const existing = new Map(ctx.scores.map((s:any)=>[`${s.assignment_id}_${s.student_id}`,s]));
    const rows = (Array.isArray(body.records) ? body.records : []).map((r:any) => {
      const assignmentId=text(r.assignmentId||r.AssignmentID), studentId=text(r.studentId||r.StudentID);
      if (!assignments.has(assignmentId)||!students.has(studentId)) throw new Error("พบรายการคะแนนนอกขอบเขตชั้นเรียน");
      const value=r.score===""||r.score==null?null:Number(r.score);
      if (value!==null&&(!Number.isFinite(value)||value<0||value>100)) throw new Error(`คะแนนของ ${studentId} ไม่ถูกต้อง`);
      const old=existing.get(`${assignmentId}_${studentId}`);
      return {score_id:old?.score_id||`SCORE_${ctx.termId}_${assignmentId}_${studentId}`,term_id:ctx.termId,assignment_id:assignmentId,student_id:studentId,subject_code:ctx.subjectCode,score:value,is_submitted:value!==null&&(r.isSubmitted===undefined||Boolean(r.isSubmitted)),updated_at:new Date().toISOString()};
    });
    if (rows.length) await api("scores?on_conflict=term_id,score_id", { method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify(rows) });
    return json({ ...output(await context(body, auth)), saved:rows.length, message:"บันทึกคะแนนเข้า Supabase สำเร็จ" });
  } catch (error) { return json({success:false,message:error instanceof Error?error.message:String(error)},400); }
});
