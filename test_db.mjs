import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  projectId: "kempt-charmer-0r5vm",
  appId: "1:615352013376:web:0f68d4191275cf892c85a5",
  apiKey: "AIzaSyAetxFDr-tXSi4RcMZamjmJrXVwKmwOF4E",
  authDomain: "kempt-charmer-0r5vm.firebaseapp.com",
  messagingSenderId: "615352013376"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "ai-studio-biomarkerandnutr-08909b73-fa3b-476a-a58f-0cce7d43db2c");

async function run() {
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("email", "==", "cwah.liu@gmail.com"));
  const users = await getDocs(q);
  if (users.empty) {
    console.log("User not found via query");
    process.exit(1);
  }
  for (const docSnap of users.docs) {
    console.log('UID:', docSnap.id);
    const v2FoodDoc = await getDoc(doc(db, 'users', docSnap.id, 'metadata', 'foodLogs_v2'));
    if (v2FoodDoc.exists()) {
      const logs = v2FoodDoc.data().logs || [];
      console.log('Food logs_v2 count:', logs.length);
    } else {
      console.log('foodLogs_v2 does not exist');
    }
  }
  process.exit(0);
}
run().catch(console.error);
