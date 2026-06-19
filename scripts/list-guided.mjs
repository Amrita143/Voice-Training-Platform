import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";
const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const agents = await getDocs(collection(db,"agents"));
const agentId = (agents.docs.find(d=>/everest/i.test(d.data().name))||agents.docs[0]).id;
const secs = (await getDocs(query(collection(db,"sections"), where("agentId","==",agentId)))).docs.map(d=>({id:d.id,...d.data()}));
const qs = (await getDocs(query(collection(db,"questions"), where("agentId","==",agentId)))).docs.map(d=>d.data());
secs.sort((a,b)=>a.order-b.order).forEach(s=>{
  const n = qs.filter(q=>q.sectionId===s.id).length;
  console.log(`[${s.id}] "${s.title}"  order=${s.order}  visibility=${s.visibility}  questions=${n}`);
});
process.exit(0);
