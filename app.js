// The Bookies — Real-time Book Club App
// Powered by Firebase Realtime Database

const { useState, useEffect, useRef, useCallback } = React;

// ── Firebase DB reference (injected by index.html) ───────────────────────────
const db = window._bookiesDB;
const ref = (path) => db.ref(path);

// ── Per-device current user (stays in localStorage — personal preference) ────
const ME_KEY = "bookies-me-v1";
const getMe  = () => { try { return JSON.parse(localStorage.getItem(ME_KEY)); } catch { return null; } };
const setMe  = (u) => { try { localStorage.setItem(ME_KEY, JSON.stringify(u)); } catch {} };

// ── Constants ─────────────────────────────────────────────────────────────────
const RATING_LABELS = ["Terrible","Poor","Mediocre","Below Avg","Average","Decent","Good","Great","Excellent","Masterpiece"];
const AVATAR_COLORS = [
  ["#C8903A","#2a1f0a"],["#5b8fa8","#0a1a20"],["#8a6fb5","#1a1028"],
  ["#6aab7e","#0d2016"],["#c96b6b","#280f0f"],["#c0a060","#221a08"],
  ["#7aa8c8","#0a1828"],["#b56fa8","#28102a"],
];
const getAC = (n) => AVATAR_COLORS[(n?.charCodeAt(0)||0) % AVATAR_COLORS.length];
const TABS  = ["All Books","Add Book","Top Rated","Wishlist","Members"];

// Firebase key-safe encode (Firebase keys can't contain . # $ [ ] /)
const toKey  = (id) => String(id).replace(/[.#$/[\]]/g, "_");
const nowStr = () => new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});

// ── Sub-components ────────────────────────────────────────────────────────────
const Avatar = ({ name, size=32 }) => {
  const [fg,bg] = getAC(name);
  return (
    <div style={{ width:size,height:size,borderRadius:"50%",background:bg,border:`1.5px solid ${fg}`,
      display:"flex",alignItems:"center",justifyContent:"center",color:fg,fontWeight:700,
      fontSize:size*0.38,fontFamily:"'Lato',sans-serif",flexShrink:0,userSelect:"none" }}>
      {(name||"?")[0].toUpperCase()}
    </div>
  );
};

const StarRating = ({ value, onChange, readOnly, small }) => {
  const [hov, setHov] = useState(0);
  const sz = readOnly ? (small?11:13) : 18;
  return (
    <div style={{ display:"flex",gap:2,alignItems:"center" }}>
      {[1,2,3,4,5,6,7,8,9,10].map(n=>(
        <span key={n}
          onClick={()=>!readOnly&&onChange(n)}
          onMouseEnter={()=>!readOnly&&setHov(n)}
          onMouseLeave={()=>!readOnly&&setHov(0)}
          style={{ cursor:readOnly?"default":"pointer",fontSize:sz,
            color:n<=(hov||value)?"#C8903A":"#3a3020",
            transition:"color 0.15s,transform 0.1s",
            transform:!readOnly&&n<=hov?"scale(1.3)":"scale(1)",
            display:"inline-block",userSelect:"none" }}>★</span>
      ))}
      {value>0 && <span style={{ color:"#C8903A",fontFamily:"'Lato'",fontSize:sz-1,marginLeft:4 }}>{value}/10</span>}
    </div>
  );
};

const Modal = ({ onClose, children }) => (
  <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",
    zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
    <div onClick={e=>e.stopPropagation()} style={{ background:"#1a160f",border:"1px solid #4a3f2a",
      borderRadius:14,padding:28,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",
      boxShadow:"0 24px 60px rgba(0,0,0,0.7)" }}>
      {children}
    </div>
  </div>
);

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <Modal onClose={onCancel}>
    <h3 style={{ fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,marginBottom:10 }}>Are you sure?</h3>
    <p style={{ color:"#9a8060",fontSize:14,marginBottom:22,lineHeight:1.5 }}>{message}</p>
    <div style={{ display:"flex",gap:10 }}>
      <button onClick={onConfirm} style={{ flex:1,background:"#5a1a1a",border:"1px solid #8a3030",
        borderRadius:8,color:"#e07070",fontFamily:"'Lato'",fontWeight:700,fontSize:12,
        letterSpacing:"0.1em",textTransform:"uppercase",padding:"12px",cursor:"pointer" }}>Delete</button>
      <button onClick={onCancel} className="secondary-btn" style={{ flex:1 }}>Cancel</button>
    </div>
  </Modal>
);

// ── Firebase listener hook ────────────────────────────────────────────────────
function useFirebaseList(path) {
  const [data, setData] = useState([]);
  useEffect(() => {
    const r = ref(path);
    const handler = snap => {
      const val = snap.val();
      if (!val) { setData([]); return; }
      // Convert Firebase object → array, preserving firebaseKey
      const arr = Object.entries(val).map(([k,v]) => ({ ...v, firebaseKey: k }));
      setData(arr);
    };
    r.on("value", handler);
    return () => r.off("value", handler);
  }, [path]);
  return data;
}

// ── Main App ──────────────────────────────────────────────────────────────────
function TheBookies() {
  const books    = useFirebaseList("books");
  const users    = useFirebaseList("users");
  const wishlist = useFirebaseList("wishlist");

  const [currentUser,  setCurrentUser] = useState(getMe);
  const [activeTab,    setActiveTab]   = useState("All Books");

  const [form,         setForm]        = useState({ title:"",author:"",rating:0,reason:"" });
  const [formErrors,   setFormErrors]  = useState({});
  const [formSaved,    setFormSaved]   = useState(false);
  const [editingBook,  setEditingBook] = useState(null);

  const [filterUser,     setFilterUser]    = useState("all");
  const [filterMin,      setFilterMin]     = useState(0);
  const [sortBy,         setSortBy]        = useState("rating");
  const [allBookSort,    setAllBookSort]   = useState("newest");
  const [searchQuery,    setSearchQuery]   = useState("");
  const [showUnreviewed, setShowUnreviewed]= useState(false);

  const [expandedId,   setExpandedId]  = useState(null);
  const [readPanelId,  setReadPanelId] = useState(null);

  const [showUserModal,    setShowUserModal]    = useState(false);
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [showReadModal,    setShowReadModal]    = useState(null);
  const [editReviewModal,  setEditReviewModal]  = useState(null);
  const [confirmModal,     setConfirmModal]     = useState(null);
  const [wishForm,         setWishForm]         = useState(false);
  const [editWish,         setEditWish]         = useState(null);

  const [newUserName,  setNewUserName]  = useState("");
  const [newUserError, setNewUserError] = useState("");

  const [readForm,   setReadForm]   = useState({ rating:0, review:"" });
  const [readErrors, setReadErrors] = useState({});
  const [readSaved,  setReadSaved]  = useState(false);

  const [wishData, setWishData] = useState({ title:"",author:"",note:"" });
  const [wishSaved,setWishSaved]= useState(false);

  // Persist current user choice locally
  useEffect(() => { setMe(currentUser); }, [currentUser]);

  // If currentUser was saved locally but name changed or is stale, re-validate
  useEffect(() => {
    if (currentUser && users.length > 0) {
      const match = users.find(u => u.name === currentUser.name);
      if (!match) setCurrentUser(null); // user was deleted
    }
  }, [users]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const bookAvg = (book) => {
    const reviews = book.readReviews ? Object.values(book.readReviews) : [];
    if (!reviews.length) return book.rating;
    const all = [book.rating, ...reviews.map(r=>r.rating)];
    return all.reduce((s,r)=>s+r,0) / all.length;
  };

  const bookReviews = (book) => book.readReviews ? Object.values(book.readReviews) : [];

  const avgRating = books.length
    ? (books.reduce((s,b)=>s+b.rating,0)/books.length).toFixed(1) : "—";

  const applySearch = (list) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
  };

  const sortedAllBooks = [...books].sort((a,b) => {
    if (allBookSort==="newest")  return b.id - a.id;
    if (allBookSort==="oldest")  return a.id - b.id;
    if (allBookSort==="rating")  return b.rating - a.rating;
    if (allBookSort==="title")   return a.title.localeCompare(b.title);
    if (allBookSort==="author")  return a.author.localeCompare(b.author);
    return 0;
  });

  const filteredBooks = applySearch(sortedAllBooks).filter(b => {
    if (filterUser !== "all" && b.addedBy !== filterUser) return false;
    if (showUnreviewed && currentUser) {
      const reviews = bookReviews(b);
      if (reviews.some(r=>r.reviewer===currentUser.name) || b.addedBy===currentUser.name) return false;
    }
    return true;
  });

  const topRated = [...books]
    .filter(b => {
      if (bookAvg(b) < filterMin) return false;
      if (filterUser !== "all") {
        const reviews = bookReviews(b);
        const hasReview = reviews.some(r=>r.reviewer===filterUser);
        if (b.addedBy !== filterUser && !hasReview) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!b.title.toLowerCase().includes(q) && !b.author.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a,b) => sortBy==="rating" ? bookAvg(b)-bookAvg(a) : a.title.localeCompare(b.title));

  const wishCount = filterUser !== "all"
    ? wishlist.filter(w=>w.addedBy===filterUser).length
    : currentUser
      ? wishlist.filter(w=>w.addedBy===currentUser.name).length
      : wishlist.length;

  // ── User handlers ──────────────────────────────────────────────────────────
  const createUser = async () => {
    const name = newUserName.trim();
    if (!name) { setNewUserError("Please enter a name"); return; }
    if (users.find(u=>u.name.toLowerCase()===name.toLowerCase())) { setNewUserError("That name is already taken"); return; }
    const u = { name, joinedAt: new Date().toLocaleDateString("en-US",{month:"short",year:"numeric"}), id: Date.now() };
    await ref("users").push(u);
    setCurrentUser(u);
    setShowNewUserModal(false); setShowUserModal(false);
    setNewUserName(""); setNewUserError("");
  };

  const switchUser = (u) => { setCurrentUser(u); setShowUserModal(false); };

  // ── Book handlers ──────────────────────────────────────────────────────────
  const validateBook = () => {
    const e = {};
    if (!form.title.trim())  e.title  = "Book title required";
    if (!form.author.trim()) e.author = "Author required";
    if (!currentUser)        e.user   = "Please set up your profile first";
    if (form.rating === 0)   e.rating = "Please rate the book";
    setFormErrors(e);
    return !Object.keys(e).length;
  };

  const submitBook = async () => {
    if (!validateBook()) return;
    if (editingBook) {
      await ref(`books/${editingBook.firebaseKey}`).update({
        title: form.title, author: form.author, rating: form.rating, reason: form.reason
      });
      setEditingBook(null);
    } else {
      const book = { ...form, id: Date.now(), addedBy: currentUser.name, createdAt: nowStr() };
      await ref("books").push(book);
    }
    setForm({title:"",author:"",rating:0,reason:""});
    setFormErrors({}); setFormSaved(true);
    setTimeout(()=>{ setFormSaved(false); setActiveTab("All Books"); }, 1400);
  };

  const startEditBook = (book) => {
    setEditingBook(book);
    setForm({ title:book.title, author:book.author, rating:book.rating, reason:book.reason||"" });
    setFormErrors({}); setActiveTab("Add Book");
  };

  const deleteBook = (book) => {
    setConfirmModal({
      message: `Delete "${book.title}"? This will also remove all reviews.`,
      onConfirm: async () => {
        await ref(`books/${book.firebaseKey}`).remove();
        // Remove any wishlist entries linked to this book
        wishlist.filter(w=>w._bookRef===`book-${book.id}`).forEach(w => {
          ref(`wishlist/${w.firebaseKey}`).remove();
        });
        setConfirmModal(null);
      }
    });
  };

  // ── Review handlers ────────────────────────────────────────────────────────
  const openReadModal = (book) => {
    if (!currentUser) { setShowUserModal(true); return; }
    setReadForm({rating:0,review:""}); setReadErrors({}); setReadSaved(false);
    setShowReadModal(book);
  };

  const submitReadReview = async () => {
    if (readForm.rating===0) { setReadErrors({rating:"Please rate the book"}); return; }
    const reviewKey = toKey(`${currentUser.name}_${Date.now()}`);
    const review = { reviewer:currentUser.name, rating:readForm.rating, review:readForm.review, date:nowStr() };
    await ref(`books/${showReadModal.firebaseKey}/readReviews/${reviewKey}`).set(review);
    setReadSaved(true);
    setTimeout(()=>setShowReadModal(null),1200);
  };

  const openEditReview = (book, review, reviewKey) => {
    setReadForm({ rating:review.rating, review:review.review||"" });
    setReadErrors({}); setReadSaved(false);
    setEditReviewModal({ book, review, reviewKey });
  };

  const submitEditReview = async () => {
    if (readForm.rating===0) { setReadErrors({rating:"Please rate the book"}); return; }
    await ref(`books/${editReviewModal.book.firebaseKey}/readReviews/${editReviewModal.reviewKey}`).update({
      rating: readForm.rating, review: readForm.review
    });
    setReadSaved(true);
    setTimeout(()=>setEditReviewModal(null),1200);
  };

  const deleteReview = (book, reviewKey, reviewerName) => {
    setConfirmModal({
      message: `Delete your review of "${book.title}"?`,
      onConfirm: async () => {
        await ref(`books/${book.firebaseKey}/readReviews/${reviewKey}`).remove();
        setConfirmModal(null);
      }
    });
  };

  // ── Wishlist handlers ──────────────────────────────────────────────────────
  const toggleWantToRead = async (book) => {
    if (!currentUser) { setShowUserModal(true); return; }
    const bookRef = `book-${book.id}`;
    const existing = wishlist.find(w=>w._bookRef===bookRef && w.addedBy===currentUser.name);
    if (existing) {
      await ref(`wishlist/${existing.firebaseKey}`).remove();
    } else {
      await ref("wishlist").push({ title:book.title, author:book.author, note:"", _bookRef:bookRef,
        addedBy:currentUser.name, id:Date.now(), createdAt:nowStr() });
    }
  };

  const isWanted = (book) => currentUser &&
    wishlist.some(w=>w._bookRef===`book-${book.id}` && w.addedBy===currentUser.name);

  const submitWish = async () => {
    if (!wishData.title.trim()) return;
    if (editWish) {
      await ref(`wishlist/${editWish.firebaseKey}`).update(wishData);
      setEditWish(null);
    } else {
      await ref("wishlist").push({ ...wishData, id:Date.now(), addedBy:currentUser?.name||"Unknown", createdAt:nowStr() });
    }
    setWishData({title:"",author:"",note:""}); setWishSaved(true);
    setTimeout(()=>setWishSaved(false),1400);
  };

  const deleteWish = (wish) => {
    setConfirmModal({
      message: `Remove "${wish.title}" from the wishlist?`,
      onConfirm: async () => { await ref(`wishlist/${wish.firebaseKey}`).remove(); setConfirmModal(null); }
    });
  };

  const promoteWish = (wish) => {
    setForm({ title:wish.title, author:wish.author||"", rating:0, reason:"" });
    setEditingBook(null); setActiveTab("Add Book");
  };

  const alreadyReviewed = (book) => currentUser && bookReviews(book).some(r=>r.reviewer===currentUser.name);
  const isMyBook        = (book) => currentUser && book.addedBy===currentUser.name;

  // ── Book Card ──────────────────────────────────────────────────────────────
  const BookCard = ({ book, rank }) => {
    const reviews   = bookReviews(book);
    // Get review entries with their Firebase keys
    const reviewEntries = book.readReviews ? Object.entries(book.readReviews) : [];
    const clubAvg   = reviews.length
      ? (([book.rating,...reviews.map(r=>r.rating)].reduce((s,r)=>s+r,0))/(reviews.length+1)).toFixed(1) : null;
    const expanded  = expandedId ===book.id;
    const readPanel = readPanelId===book.id;
    const rc=["#FFD700","#C0C0C0","#CD7F32"], rb=["#2a2200","#1e1e1e","#1f1400"];

    return (
      <div className="card animate-in" style={{ padding:"20px 22px" }}>
        <div style={{ display:"flex",gap:14,alignItems:"flex-start" }}>
          {rank!==undefined && (
            <div style={{ width:34,height:34,borderRadius:"50%",flexShrink:0,
              background:rank<3?rb[rank]:"#1a160f",color:rank<3?rc[rank]:"#5a5040",
              border:`1px solid ${rank<3?rc[rank]+"55":"#3a3020"}`,
              display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:13
            }}>{rank+1}</div>
          )}
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap" }}>
              <div>
                <h3 style={{ fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:700,lineHeight:1.2,marginBottom:2 }}>{book.title}</h3>
                <div style={{ color:"#9a8060",fontSize:12,fontStyle:"italic",marginBottom:8 }}>by {book.author}</div>
                <StarRating value={book.rating} readOnly />
                {clubAvg && <div style={{ marginTop:4,fontSize:11,color:"#6a5a40" }}>Club avg: <span style={{ color:"#C8903A",fontWeight:700 }}>{clubAvg}/10</span></div>}
              </div>
              <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5 }}>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  <Avatar name={book.addedBy} size={22}/>
                  <span className="badge" style={{ fontSize:10 }}>{book.addedBy}</span>
                </div>
                <span style={{ color:"#3a3020",fontSize:10 }}>{book.createdAt}</span>
                {reviews.length>0 && <span className="badge" style={{ fontSize:10,color:"#6aab7e",borderColor:"#2a4a32" }}>✓ {reviews.length} read it</span>}
              </div>
            </div>

            <div style={{ display:"flex",gap:10,marginTop:12,flexWrap:"wrap",alignItems:"center" }}>
              {book.reason && <button className="expand-btn" onClick={()=>setExpandedId(expanded?null:book.id)}>{expanded?"▲ Hide":"▼ Why Read It"}</button>}
              {reviews.length>0 && <button className="expand-btn" style={{ color:"#6aab7e" }} onClick={()=>setReadPanelId(readPanel?null:book.id)}>{readPanel?"▲ Hide":`▼ ${reviews.length} Review${reviews.length>1?"s":""}`}</button>}
              <div style={{ display:"flex",gap:8,marginLeft:"auto",alignItems:"center" }}>
                <button className={`want-btn${isWanted(book)?" wanted":""}`} onClick={()=>toggleWantToRead(book)}>
                  {isWanted(book) ? "🔖 Want to Read" : "🔖"}
                </button>
                {isMyBook(book) && (
                  <><button className="icon-btn edit" onClick={()=>startEditBook(book)}>✏</button>
                    <button className="icon-btn del"  onClick={()=>deleteBook(book)}>🗑</button></>
                )}
                {!isMyBook(book) && !alreadyReviewed(book) && (
                  <button className="read-btn" onClick={()=>openReadModal(book)}>+ I've Read It</button>
                )}
                {alreadyReviewed(book) && <span style={{ fontSize:11,color:"#4a7a54" }}>✓ Reviewed</span>}
              </div>
            </div>

            {expanded && book.reason && (
              <div className="animate-in" style={{ marginTop:10,background:"#0d0b07",borderLeft:"2px solid #C8903A",borderRadius:"0 6px 6px 0",padding:"10px 14px",color:"#c8b898",fontSize:13,fontStyle:"italic",lineHeight:1.6 }}>"{book.reason}"</div>
            )}

            {readPanel && reviewEntries.length>0 && (
              <div className="animate-in" style={{ marginTop:12,display:"flex",flexDirection:"column",gap:10 }}>
                {reviewEntries.map(([rKey, r])=>{
                  const canEdit = currentUser?.name===r.reviewer;
                  return (
                    <div key={rKey} style={{ background:"#0d0b07",border:"1px solid #2a2315",borderRadius:8,padding:"12px 14px" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:6 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                          <Avatar name={r.reviewer} size={20}/>
                          <span style={{ fontSize:12,fontWeight:700,color:"#EDE7D9" }}>{r.reviewer}</span>
                        </div>
                        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                          <StarRating value={r.rating} readOnly small/>
                          <span style={{ fontSize:10,color:"#4a3f2a" }}>{r.date}</span>
                          {canEdit && <>
                            <button className="icon-btn edit" style={{ fontSize:11 }} onClick={()=>openEditReview(book,r,rKey)}>✏</button>
                            <button className="icon-btn del"  style={{ fontSize:11 }} onClick={()=>deleteReview(book,rKey,r.reviewer)}>🗑</button>
                          </>}
                        </div>
                      </div>
                      {r.review && <p style={{ fontSize:13,color:"#a09070",fontStyle:"italic",lineHeight:1.5,margin:0 }}>"{r.review}"</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Review modal body ──────────────────────────────────────────────────────
  const ReviewModalBody = ({ title, bookInfo, onSubmit, saved }) => (
    <>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18 }}>
        <div>
          <h2 style={{ fontFamily:"'Playfair Display',serif",fontSize:19,fontWeight:700,marginBottom:3 }}>{title}</h2>
          <p style={{ color:"#9a8060",fontSize:13,fontStyle:"italic" }}>{bookInfo}</p>
        </div>
        <button onClick={()=>{ setShowReadModal(null); setEditReviewModal(null); }}
          style={{ background:"none",border:"none",color:"#6a5a40",cursor:"pointer",fontSize:20,marginLeft:12 }}>✕</button>
      </div>
      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:20,padding:"10px 14px",background:"#0d0b07",borderRadius:8 }}>
        <Avatar name={currentUser?.name} size={26}/>
        <span style={{ fontSize:13,color:"#9a8060" }}>As <strong style={{ color:"#EDE7D9" }}>{currentUser?.name}</strong></span>
      </div>
      <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
        <div>
          <label>Your Rating *</label>
          <div style={{ display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
            <StarRating value={readForm.rating} onChange={v=>setReadForm(f=>({...f,rating:v}))}/>
            <select className="filter-select" value={readForm.rating} onChange={e=>setReadForm(f=>({...f,rating:+e.target.value}))}>
              <option value={0}>Select rating</option>
              {[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} — {RATING_LABELS[n-1]}</option>)}
            </select>
          </div>
          {readErrors.rating && <div className="error-text">{readErrors.rating}</div>}
        </div>
        <div>
          <label>My Review</label>
          <textarea className="input-field" rows={4} placeholder="What did you think?" style={{ resize:"vertical" }}
            value={readForm.review} onChange={e=>setReadForm(f=>({...f,review:e.target.value}))}/>
        </div>
        <button className={`submit-btn${saved?" saved-flash":""}`} onClick={onSubmit}>{saved?"✓ Saved!":"Submit Review"}</button>
      </div>
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'Lato',sans-serif",minHeight:"100vh",background:"#13100A",color:"#EDE7D9",overflowX:"hidden" }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:#1e1a12} ::-webkit-scrollbar-thumb{background:#4a3f2a;border-radius:3px}
        input,textarea,select{outline:none}
        .tab-btn{background:none;border:none;cursor:pointer;font-family:'Lato',sans-serif;letter-spacing:0.12em;text-transform:uppercase;font-size:11px;font-weight:700;padding:10px 14px;transition:all 0.2s;white-space:nowrap}
        .card{background:linear-gradient(135deg,#1e1a12 0%,#17140d 100%);border:1px solid #3a3020;border-radius:12px;transition:border-color 0.2s}
        .card:hover{border-color:#5a4a2a}
        .input-field{width:100%;background:#0d0b07;border:1px solid #3a3020;border-radius:8px;padding:11px 13px;color:#EDE7D9;font-family:'Lato',sans-serif;font-size:14px;transition:border-color 0.2s}
        .input-field:focus{border-color:#C8903A} .input-field::placeholder{color:#5a5040}
        .submit-btn{background:linear-gradient(135deg,#C8903A,#a0702a);border:none;border-radius:8px;color:#13100A;font-family:'Lato',sans-serif;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:13px 28px;cursor:pointer;font-size:12px;transition:opacity 0.2s,transform 0.1s}
        .submit-btn:hover{opacity:0.88;transform:translateY(-1px)}
        .secondary-btn{background:#1e1a12;border:1px solid #4a3f2a;border-radius:8px;color:#9a8060;font-family:'Lato',sans-serif;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:10px 20px;cursor:pointer;font-size:11px;transition:border-color 0.2s,color 0.2s}
        .secondary-btn:hover{border-color:#C8903A;color:#C8903A}
        .read-btn{background:none;border:1px solid #2a4060;border-radius:6px;cursor:pointer;color:#7aa8c8;font-family:'Lato',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;padding:4px 12px;transition:all 0.2s}
        .read-btn:hover{background:#0a1828;border-color:#5b8fa8}
        .want-btn{background:none;border:1px solid #3a3020;border-radius:6px;cursor:pointer;color:#5a5040;font-family:'Lato',sans-serif;font-size:11px;padding:4px 10px;transition:all 0.2s;white-space:nowrap}
        .want-btn:hover{border-color:#8a6f30;color:#C8903A;background:#1a1208}
        .want-btn.wanted{background:#2a1f0a;border-color:#C8903A;color:#C8903A}
        .icon-btn{background:none;border:none;cursor:pointer;padding:3px 6px;border-radius:5px;font-size:13px;transition:background 0.15s;line-height:1}
        .icon-btn.edit{color:#7aa8c8} .icon-btn.edit:hover{background:#0a1828}
        .icon-btn.del{color:#c96b6b}  .icon-btn.del:hover{background:#280f0f}
        .badge{display:inline-flex;align-items:center;background:#2a2315;border:1px solid #4a3f2a;border-radius:20px;padding:3px 10px;font-size:11px;color:#9a8060}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .animate-in{animation:fadeIn 0.25s ease forwards}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
        .saved-flash{animation:pulse 0.4s ease 3}
        .expand-btn{background:none;border:none;cursor:pointer;color:#C8903A;font-family:'Lato',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;padding:0;transition:opacity 0.2s}
        .expand-btn:hover{opacity:0.65}
        .filter-select{background:#0d0b07;border:1px solid #3a3020;border-radius:6px;color:#EDE7D9;padding:6px 10px;font-family:'Lato',sans-serif;font-size:12px;cursor:pointer}
        .error-text{color:#e05a5a;font-size:11px;margin-top:4px}
        .search-wrap{position:relative;flex:1;min-width:160px}
        .search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#5a5040;font-size:14px;pointer-events:none}
        .toggle-pill{display:inline-flex;align-items:center;gap:7px;background:#1a160f;border:1px solid #3a3020;border-radius:20px;padding:5px 14px;cursor:pointer;font-size:11px;color:#6a5a40;font-family:'Lato';letter-spacing:0.08em;text-transform:uppercase;transition:all 0.2s;user-select:none}
        .toggle-pill:hover{border-color:#C8903A;color:#C8903A}
        .toggle-pill.on{background:#2a1f0a;border-color:#C8903A;color:#C8903A}
        .user-row{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:8px;cursor:pointer;border:1px solid transparent;transition:all 0.2s;margin-bottom:6px}
        .user-row:hover{background:#1e1a12;border-color:#4a3f2a}
        .user-row.active-user{background:#1e1a12;border-color:#C8903A}
        label{display:block;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8060;margin-bottom:6px}
        .wish-card{background:#0f0d09;border:1px solid #2a2315;border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;transition:border-color 0.2s}
        .wish-card:hover{border-color:#4a3f2a}
        .stat-box{text-align:center;background:#1a160f;border:1px solid #3a3020;border-radius:10px;padding:7px 12px;cursor:pointer;transition:all 0.2s}
        .stat-box:hover{border-color:#C8903A55;transform:translateY(-2px)}
        .stat-box.active{border-color:#C8903A55}
        .live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#6aab7e;box-shadow:0 0 6px #6aab7e;animation:livepulse 2s infinite}
        @keyframes livepulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(0.85)}}
      `}</style>

      {/* HEADER */}
      <div style={{ background:"linear-gradient(180deg,#0d0b07 0%,#13100A 100%)",borderBottom:"1px solid #2a2315",padding:"26px 24px 0" }}>
        <div style={{ maxWidth:900,margin:"0 auto" }}>
          <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:20 }}>
            <div>
              <div style={{ color:"#C8903A",fontSize:10,letterSpacing:"0.3em",textTransform:"uppercase",marginBottom:5,display:"flex",alignItems:"center",gap:8 }}>
                <span className="live-dot"></span> Live · All members sync in real time
              </div>
              <h1 style={{ fontFamily:"'Playfair Display',serif",fontSize:"clamp(26px,5vw,44px)",fontWeight:900,lineHeight:1,letterSpacing:"-0.01em" }}>
                The <span style={{ fontStyle:"italic",color:"#C8903A" }}>Bookies</span>
              </h1>
            </div>
            <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
              {[["Books","All Books",books.length],["Top Rated","Top Rated",avgRating],["Members","Members",users.length],["Wishlist","Wishlist",wishCount]].map(([l,tab,v])=>(
                <div key={l} className={`stat-box${activeTab===tab?" active":""}`} onClick={()=>setActiveTab(tab)}>
                  <div style={{ fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:"#C8903A" }}>{v}</div>
                  <div style={{ fontSize:9,color:"#6a5a40",letterSpacing:"0.15em",textTransform:"uppercase" }}>{l}</div>
                </div>
              ))}
              <button onClick={()=>setShowUserModal(true)} style={{ display:"flex",alignItems:"center",gap:8,background:"#1a160f",
                border:`1px solid ${currentUser?"#C8903A55":"#4a3f2a"}`,borderRadius:10,padding:"7px 14px",cursor:"pointer",
                color:"#EDE7D9",fontFamily:"'Lato'",fontSize:12,transition:"all 0.2s" }}>
                {currentUser
                  ? <><Avatar name={currentUser.name} size={26}/><span style={{ fontWeight:700 }}>{currentUser.name}</span></>
                  : <><span>👤</span><span style={{ color:"#9a8060" }}>Set Profile</span></>}
              </button>
            </div>
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:8 }}>
            <div style={{ display:"flex",flexWrap:"wrap" }}>
              {TABS.map(tab=>(
                <button key={tab} className="tab-btn" onClick={()=>setActiveTab(tab)} style={{
                  color:activeTab===tab?"#C8903A":"#6a5a40",
                  borderBottom:activeTab===tab?"2px solid #C8903A":"2px solid transparent",paddingBottom:12
                }}>{tab}</button>
              ))}
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8,paddingBottom:12 }}>
              <span style={{ fontSize:10,color:"#4a3f2a",letterSpacing:"0.15em",textTransform:"uppercase" }}>Member</span>
              <select className="filter-select" value={filterUser} onChange={e=>setFilterUser(e.target.value)}>
                <option value="all">All</option>
                {users.map(u=><option key={u.name} value={u.name}>{u.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth:900,margin:"0 auto",padding:"26px 24px" }}>

        {/* ALL BOOKS */}
        {activeTab==="All Books" && (
          <div className="animate-in">
            <div style={{ display:"flex",gap:10,marginBottom:20,flexWrap:"wrap",alignItems:"center" }}>
              <div className="search-wrap">
                <span className="search-icon">🔍</span>
                <input className="input-field" placeholder="Search title or author…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} style={{ paddingLeft:32 }}/>
              </div>
              <select className="filter-select" value={allBookSort} onChange={e=>setAllBookSort(e.target.value)}>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="rating">Highest Rated</option>
                <option value="title">A–Z Title</option>
                <option value="author">A–Z Author</option>
              </select>
              {currentUser && (
                <div className={`toggle-pill${showUnreviewed?" on":""}`} onClick={()=>setShowUnreviewed(v=>!v)}>
                  <span>{showUnreviewed?"●":"○"}</span> Unreviewed
                </div>
              )}
            </div>
            {filteredBooks.length===0
              ? <div style={{ textAlign:"center",padding:"60px 0",color:"#4a3f2a" }}>
                  <div style={{ fontFamily:"'Playfair Display',serif",fontSize:20,fontStyle:"italic",marginBottom:8 }}>
                    {searchQuery?`No books matching "${searchQuery}"`:showUnreviewed?"You've reviewed everything!":filterUser!=="all"?`No books from ${filterUser} yet`:"No books yet"}
                  </div>
                  {!searchQuery&&!showUnreviewed&&<button className="submit-btn" style={{ marginTop:14 }} onClick={()=>setActiveTab("Add Book")}>Add First Book</button>}
                </div>
              : <div style={{ display:"flex",flexDirection:"column",gap:13 }}>
                  <div style={{ fontSize:11,color:"#4a3f2a",letterSpacing:"0.1em" }}>{filteredBooks.length} book{filteredBooks.length!==1?"s":""}</div>
                  {filteredBooks.map(book=><BookCard key={book.firebaseKey} book={book}/>)}
                </div>
            }
          </div>
        )}

        {/* ADD / EDIT BOOK */}
        {activeTab==="Add Book" && (
          <div className="animate-in">
            {!currentUser && (
              <div style={{ background:"#1a1208",border:"1px solid #4a3a18",borderRadius:10,padding:"14px 18px",marginBottom:18,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10 }}>
                <span style={{ color:"#c8903a",fontSize:13 }}>⚠ Set up your profile before adding a book</span>
                <button className="secondary-btn" onClick={()=>setShowUserModal(true)}>Set Profile</button>
              </div>
            )}
            <div className="card" style={{ padding:"28px" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4 }}>
                <h2 style={{ fontFamily:"'Playfair Display',serif",fontSize:21,fontWeight:700 }}>{editingBook?"Edit Book":"Recommend a Book"}</h2>
                {editingBook && <button className="secondary-btn" style={{ padding:"6px 14px",fontSize:10 }} onClick={()=>{ setEditingBook(null); setForm({title:"",author:"",rating:0,reason:""}); setFormErrors({}); }}>✕ Cancel Edit</button>}
              </div>
              <p style={{ color:"#6a5a40",fontSize:13,marginBottom:24 }}>{editingBook?"Update the details below":"Share your pick with the club"}</p>
              <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>
                  <div>
                    <label>Book Title *</label>
                    <input className="input-field" placeholder="e.g. The Midnight Library" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/>
                    {formErrors.title && <div className="error-text">{formErrors.title}</div>}
                  </div>
                  <div>
                    <label>Author *</label>
                    <input className="input-field" placeholder="e.g. Matt Haig" value={form.author} onChange={e=>setForm(f=>({...f,author:e.target.value}))}/>
                    {formErrors.author && <div className="error-text">{formErrors.author}</div>}
                  </div>
                </div>
                <div>
                  <label>Your Rating *</label>
                  <div style={{ display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
                    <StarRating value={form.rating} onChange={v=>setForm(f=>({...f,rating:v}))}/>
                    <select className="filter-select" value={form.rating} onChange={e=>setForm(f=>({...f,rating:+e.target.value}))}>
                      <option value={0}>Select rating</option>
                      {[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} — {RATING_LABELS[n-1]}</option>)}
                    </select>
                  </div>
                  {formErrors.rating && <div className="error-text">{formErrors.rating}</div>}
                </div>
                <div>
                  <label>Why I Would Read It</label>
                  <textarea className="input-field" rows={4} placeholder="What makes this book worth reading?" style={{ resize:"vertical" }} value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))}/>
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
                  <button className={`submit-btn${formSaved?" saved-flash":""}`} onClick={submitBook}>
                    {formSaved?"✓ Saved!":(editingBook?"Save Changes":"Add to Club List")}
                  </button>
                  {currentUser && <div style={{ display:"flex",alignItems:"center",gap:8 }}><Avatar name={currentUser.name} size={24}/><span style={{ fontSize:12,color:"#9a8060" }}>{editingBook?"Editing as":"Adding as"} <strong style={{ color:"#EDE7D9" }}>{currentUser.name}</strong></span></div>}
                  {formErrors.user && <div className="error-text">{formErrors.user}</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TOP RATED */}
        {activeTab==="Top Rated" && (
          <div className="animate-in">
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap" }}>
              <div className="search-wrap" style={{ maxWidth:260 }}>
                <span className="search-icon">🔍</span>
                <input className="input-field" placeholder="Search…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} style={{ paddingLeft:32 }}/>
              </div>
              <select className="filter-select" value={filterMin} onChange={e=>setFilterMin(+e.target.value)}>
                {[0,5,6,7,8,9].map(n=><option key={n} value={n}>{n===0?"All Ratings":`${n}+ stars`}</option>)}
              </select>
              <select className="filter-select" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
                <option value="rating">Highest Rated</option>
                <option value="title">A–Z Title</option>
              </select>
              <span className="badge">{topRated.length} book{topRated.length!==1?"s":""}</span>
            </div>
            {topRated.length===0
              ? <div style={{ textAlign:"center",padding:"60px 0",color:"#4a3f2a" }}><div style={{ fontFamily:"'Playfair Display',serif",fontSize:20,fontStyle:"italic" }}>No books match your filters</div></div>
              : <div style={{ display:"flex",flexDirection:"column",gap:13 }}>{topRated.map((book,i)=><BookCard key={book.firebaseKey} book={book} rank={i}/>)}</div>
            }
          </div>
        )}

        {/* WISHLIST */}
        {activeTab==="Wishlist" && (()=>{
          const wishUser = filterUser!=="all" ? filterUser : currentUser?.name;
          const visibleWishlist = wishUser ? wishlist.filter(w=>w.addedBy===wishUser) : wishlist;
          return (
            <div className="animate-in">
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12 }}>
                <div>
                  <h2 style={{ fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,marginBottom:2 }}>Want to Read</h2>
                  <p style={{ color:"#5a5040",fontSize:12 }}>{wishUser ? <span><span style={{ color:"#C8903A" }}>{wishUser}</span>'s reading wishlist</span> : "Books the club wants to get to"}</p>
                </div>
                <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
                  {filterUser!=="all" && <button className="secondary-btn" style={{ fontSize:10,padding:"6px 14px" }} onClick={()=>setFilterUser("all")}>View All</button>}
                  {currentUser && <button className="secondary-btn" onClick={()=>{ setWishData({title:"",author:"",note:""}); setEditWish(null); setWishForm(true); }}>+ Add to Wishlist</button>}
                </div>
              </div>
              {filterUser!=="all" && (
                <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16,padding:"10px 14px",background:"#0d0b07",border:"1px solid #2a2315",borderRadius:8 }}>
                  <Avatar name={filterUser} size={24}/>
                  <span style={{ fontSize:12,color:"#9a8060" }}>Showing wishlist for <strong style={{ color:"#EDE7D9" }}>{filterUser}</strong></span>
                  <button className="expand-btn" style={{ marginLeft:"auto" }} onClick={()=>setFilterUser("all")}>✕ Clear</button>
                </div>
              )}
              {(wishForm||editWish) && (
                <div className="card animate-in" style={{ padding:"22px",marginBottom:18 }}>
                  <h3 style={{ fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,marginBottom:16 }}>{editWish?"Edit Wish":"Add a Book to Wishlist"}</h3>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 }}>
                    <div><label>Title *</label><input className="input-field" placeholder="Book title" value={wishData.title} onChange={e=>setWishData(d=>({...d,title:e.target.value}))}/></div>
                    <div><label>Author</label><input className="input-field" placeholder="Author name" value={wishData.author} onChange={e=>setWishData(d=>({...d,author:e.target.value}))}/></div>
                  </div>
                  <div style={{ marginBottom:14 }}><label>Note</label><input className="input-field" placeholder="Why does the club want to read this?" value={wishData.note} onChange={e=>setWishData(d=>({...d,note:e.target.value}))}/></div>
                  <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
                    <button className={`submit-btn${wishSaved?" saved-flash":""}`} onClick={submitWish}>{wishSaved?"✓ Saved!":(editWish?"Save Changes":"Add to Wishlist")}</button>
                    <button className="secondary-btn" onClick={()=>{ setWishForm(false); setEditWish(null); setWishData({title:"",author:"",note:""}); }}>Cancel</button>
                    {currentUser && <div style={{ display:"flex",alignItems:"center",gap:8 }}><Avatar name={currentUser.name} size={22}/><span style={{ fontSize:12,color:"#9a8060" }}>Adding as <strong style={{ color:"#EDE7D9" }}>{currentUser.name}</strong></span></div>}
                  </div>
                </div>
              )}
              {visibleWishlist.length===0
                ? <div style={{ textAlign:"center",padding:"60px 0",color:"#4a3f2a" }}>
                    <div style={{ fontFamily:"'Playfair Display',serif",fontSize:20,fontStyle:"italic",marginBottom:8 }}>
                      {wishUser&&filterUser!=="all"?`${wishUser} has no wishlist entries`:currentUser?"Your wishlist is empty":"Wishlist is empty"}
                    </div>
                    {currentUser && <button className="submit-btn" style={{ marginTop:4 }} onClick={()=>{ setWishData({title:"",author:"",note:""}); setWishForm(true); }}>Add First Book</button>}
                  </div>
                : <>
                    <div style={{ fontSize:11,color:"#4a3f2a",letterSpacing:"0.1em",marginBottom:12 }}>{visibleWishlist.length} item{visibleWishlist.length!==1?"s":""}</div>
                    <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                      {visibleWishlist.map(wish=>(
                        <div key={wish.firebaseKey} className="wish-card">
                          <div style={{ flex:1 }}>
                            <div style={{ fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,marginBottom:2 }}>{wish.title}</div>
                            {wish.author && <div style={{ color:"#9a8060",fontSize:12,fontStyle:"italic",marginBottom:6 }}>by {wish.author}</div>}
                            {wish.note   && <div style={{ color:"#6a5a40",fontSize:12,lineHeight:1.5 }}>"{wish.note}"</div>}
                            <div style={{ display:"flex",alignItems:"center",gap:8,marginTop:8 }}>
                              <Avatar name={wish.addedBy} size={18}/>
                              <span style={{ fontSize:10,color:"#4a3f2a" }}>{wish.addedBy} · {wish.createdAt}</span>
                            </div>
                          </div>
                          <div style={{ display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end",flexShrink:0 }}>
                            <button className="secondary-btn" style={{ fontSize:10,padding:"5px 12px",whiteSpace:"nowrap" }} onClick={()=>promoteWish(wish)}>→ Add as Book</button>
                            {currentUser?.name===wish.addedBy && (
                              <div style={{ display:"flex",gap:6 }}>
                                <button className="icon-btn edit" onClick={()=>{ setWishData({title:wish.title,author:wish.author||"",note:wish.note||""}); setEditWish(wish); setWishForm(false); }}>✏</button>
                                <button className="icon-btn del"  onClick={()=>deleteWish(wish)}>🗑</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
              }
            </div>
          );
        })()}

        {/* MEMBERS */}
        {activeTab==="Members" && (
          <div className="animate-in">
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12 }}>
              <h2 style={{ fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700 }}>Club Members</h2>
              <button className="secondary-btn" onClick={()=>setShowNewUserModal(true)}>+ New Member</button>
            </div>
            {users.length===0
              ? <div style={{ textAlign:"center",padding:"60px 0",color:"#4a3f2a" }}>
                  <div style={{ fontFamily:"'Playfair Display',serif",fontSize:20,fontStyle:"italic",marginBottom:8 }}>No members yet</div>
                  <button className="submit-btn" onClick={()=>setShowNewUserModal(true)}>Create First Profile</button>
                </div>
              : <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:14 }}>
                  {users.map(u=>{
                    const myBooks   = books.filter(b=>b.addedBy===u.name).length;
                    const myReviews = books.reduce((s,b)=>s+bookReviews(b).filter(r=>r.reviewer===u.name).length,0);
                    const unread    = books.filter(b=>b.addedBy!==u.name&&!bookReviews(b).some(r=>r.reviewer===u.name)).length;
                    const isMe      = currentUser?.name===u.name;
                    return (
                      <div key={u.firebaseKey||u.name} className="card" style={{ padding:"18px 20px",border:isMe?"1px solid #C8903A55":undefined }}>
                        <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:14 }}>
                          <Avatar name={u.name} size={40}/>
                          <div>
                            <div style={{ fontWeight:700,fontSize:15 }}>{u.name}</div>
                            <div style={{ fontSize:10,color:"#5a5040",letterSpacing:"0.1em" }}>Since {u.joinedAt}</div>
                            {isMe && <span style={{ fontSize:9,color:"#C8903A",letterSpacing:"0.1em",textTransform:"uppercase" }}>● Active</span>}
                          </div>
                        </div>
                        <div style={{ display:"flex",gap:8,marginBottom:14 }}>
                          {[["Added",myBooks,"#C8903A"],["Reviews",myReviews,"#6aab7e"],["To Read",unread,"#7aa8c8"]].map(([lbl,val,col])=>(
                            <div key={lbl} style={{ flex:1,background:"#0d0b07",borderRadius:8,padding:"7px 6px",textAlign:"center" }}>
                              <div style={{ fontFamily:"'Playfair Display'",fontSize:18,fontWeight:700,color:col }}>{val}</div>
                              <div style={{ fontSize:8,color:"#5a5040",textTransform:"uppercase",letterSpacing:"0.08em" }}>{lbl}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display:"flex",gap:8 }}>
                          <button className="secondary-btn" style={{ flex:1,padding:"7px",fontSize:10 }} onClick={()=>{ setFilterUser(u.name); setActiveTab("All Books"); }}>View Books</button>
                          {!isMe && <button className="secondary-btn" style={{ flex:1,padding:"7px",fontSize:10 }} onClick={()=>switchUser(u)}>Switch to</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        )}
      </div>

      {/* MODALS */}
      {showUserModal && (
        <Modal onClose={()=>setShowUserModal(false)}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
            <h2 style={{ fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700 }}>{currentUser?"Switch Profile":"Choose Your Profile"}</h2>
            <button onClick={()=>setShowUserModal(false)} style={{ background:"none",border:"none",color:"#6a5a40",cursor:"pointer",fontSize:20 }}>✕</button>
          </div>
          {users.length===0
            ? <p style={{ color:"#6a5a40",fontSize:14,marginBottom:16,textAlign:"center" }}>No members yet.</p>
            : <div style={{ marginBottom:14 }}>
                {users.map(u=>(
                  <div key={u.firebaseKey||u.name} className={`user-row${currentUser?.name===u.name?" active-user":""}`} onClick={()=>switchUser(u)}>
                    <Avatar name={u.name} size={36}/>
                    <div style={{ flex:1 }}><div style={{ fontWeight:700,fontSize:14 }}>{u.name}</div><div style={{ fontSize:11,color:"#5a5040" }}>Since {u.joinedAt}</div></div>
                    {currentUser?.name===u.name && <span style={{ fontSize:11,color:"#C8903A" }}>✓ Active</span>}
                  </div>
                ))}
              </div>
          }
          <button className="secondary-btn" style={{ width:"100%" }} onClick={()=>{ setShowUserModal(false); setShowNewUserModal(true); }}>+ Create New Profile</button>
        </Modal>
      )}

      {showNewUserModal && (
        <Modal onClose={()=>{ setShowNewUserModal(false); setNewUserName(""); setNewUserError(""); }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
            <h2 style={{ fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700 }}>Create Profile</h2>
            <button onClick={()=>{ setShowNewUserModal(false); setNewUserName(""); setNewUserError(""); }}
              style={{ background:"none",border:"none",color:"#6a5a40",cursor:"pointer",fontSize:20 }}>✕</button>
          </div>
          <p style={{ color:"#6a5a40",fontSize:13,marginBottom:20 }}>Enter your name to join the club.</p>
          <label>Your Name</label>
          <input className="input-field" placeholder="e.g. Sarah" value={newUserName}
            onChange={e=>{ setNewUserName(e.target.value); setNewUserError(""); }}
            onKeyDown={e=>e.key==="Enter"&&createUser()} style={{ marginBottom:6 }}/>
          {newUserError && <div className="error-text" style={{ marginBottom:10 }}>{newUserError}</div>}
          <div style={{ display:"flex",gap:10,marginTop:18 }}>
            <button className="submit-btn" style={{ flex:1 }} onClick={createUser}>Join the Club</button>
            <button className="secondary-btn" onClick={()=>{ setShowNewUserModal(false); setNewUserName(""); setNewUserError(""); }}>Cancel</button>
          </div>
        </Modal>
      )}

      {showReadModal && (
        <Modal onClose={()=>setShowReadModal(null)}>
          <ReviewModalBody title="I've Read This Book" bookInfo={`${showReadModal.title} · ${showReadModal.author}`} onSubmit={submitReadReview} saved={readSaved}/>
        </Modal>
      )}

      {editReviewModal && (
        <Modal onClose={()=>setEditReviewModal(null)}>
          <ReviewModalBody title="Edit My Review" bookInfo={`${editReviewModal.book.title} · ${editReviewModal.book.author}`} onSubmit={submitEditReview} saved={readSaved}/>
        </Modal>
      )}

      {confirmModal && <ConfirmModal message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={()=>setConfirmModal(null)}/>}

      <div style={{ textAlign:"center",padding:"20px",borderTop:"1px solid #1e1a12",color:"#3a3020",fontSize:10,letterSpacing:"0.2em",textTransform:"uppercase" }}>
        The Bookies · Powered by Firebase · Live sync enabled
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(TheBookies));
