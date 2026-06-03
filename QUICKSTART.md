# ⚡ Quick Start Guide

## 🏃 In 3 Steps

### 1️⃣ Install Dependencies
```bash
npm install
```

### 2️⃣ Start Development Server
```bash
npm run dev
```

### 3️⃣ Open Browser
Go to: **http://localhost:3000**

---

## 📍 Main Routes

- **`/`** - Home Page
- **`/leads`** - Leads Dashboard (Main Page)
- **`/api/leads`** - Backend API

---

## ✨ Key Features

✅ View all leads in interactive table  
✅ Search by name, email, phone  
✅ Filter by status & property type  
✅ Export to CSV  
✅ Pagination (5, 10, 25, 50 items)  
✅ Real-time data from Real Estate API  
✅ Mobile responsive design  

---

## 🔑 Configuration

Your API keys are already set in `.env.local`:
```
NEXT_PUBLIC_REAL_ESTATE_API_KEY=...
REAL_ESTATE_API_SECRET=...
```

---

## 🎯 How to Use

1. Go to `/leads` page
2. See all leads automatically loaded
3. Use Search box to find specific leads
4. Use dropdowns to filter by Status or Property Type
5. Click "Search" to apply filters
6. Click "Export CSV" to download leads
7. Use pagination at bottom to browse pages

---

## 📊 Status Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| New | 🔵 Blue | Fresh lead |
| Contacted | 🟠 Orange | Initial contact made |
| Qualified | 🟣 Purple | Verified potential customer |
| Converted | 🟢 Green | Became customer |
| Lost | 🔴 Red | Not interested |

---

## 🛠️ Build for Production

```bash
# Create production build
npm run build

# Start production server
npm start
```

---

## 📁 Important Files

| File | Purpose |
|------|---------|
| `src/app/leads/page.tsx` | Main leads page |
| `src/components/LeadsTable.tsx` | Leads table component |
| `src/lib/realEstateApi.ts` | API client |
| `src/services/lead.service.ts` | Business logic |
| `src/app/api/leads/route.ts` | Backend endpoint |

---

## 🐛 Common Issues & Fixes

**Problem**: Leads not loading  
**Fix**: Check .env.local has correct API keys

**Problem**: Build fails  
**Fix**: Run `npm install` again

**Problem**: Module not found  
**Fix**: Make sure you're in the correct directory

---

## 📞 Need Help?

1. Check `PROJECT_DOCUMENTATION.md` for detailed info
2. Check `IMPLEMENTATION_GUIDE.md` for architecture
3. Review component files - they're well commented

---

**You're all set! 🎉**
