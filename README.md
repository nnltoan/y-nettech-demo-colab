# Y-Nettech Demo Collab — Production Report System

Demo app + technical docs cho dự án **FCC Vietnam Smart Factory Production Report System**, hợp tác giữa **DanaExperts** (ERP Odoo) và **Y-Nettech** (IoT/Automation).

## Live Demo

Sau khi GitHub Actions deploy xong, demo sẽ live tại:

> **https://nnltoan.github.io/y-nettech-demo-colab/**

## Cấu trúc repo

```
y-nettech-demo-colab/
├── demo-app/                   React + Vite prototype (tablet-first UI)
│   ├── src/
│   │   ├── App.jsx             Single-file app (~6500 dòng)
│   │   ├── main.jsx
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.js          Dual-target base path (GH Pages / local)
│   └── index.html
├── docs/                       Technical documentation
│   ├── UserManual_TiengViet_v3.docx
│   ├── SRS_Production_Report_System.md
│   ├── Basic_Design_Production_Report_System.md
│   └── PLAN_Demo_Production_Report_App.md
└── .github/workflows/
    └── deploy-pages.yml        Auto-deploy demo-app lên GitHub Pages
```

## Chạy demo-app cục bộ

```bash
cd demo-app
npm install
npm run dev
```

Mở http://localhost:5173 để xem app.

## Build production

```bash
cd demo-app
npm run build      # build cho local / Vercel (base = '/')
npm run preview    # preview bản build
```

Để build với subpath cho GitHub Pages:

```bash
DEPLOY_TARGET=github-pages npm run build
```

(Trên Windows PowerShell: `$env:DEPLOY_TARGET="github-pages"; npm run build`)

## Feature chính của demo-app

- **Team-based organization**: 9 teams (Press / CNC / Mill × 3 shifts), 45 users
- **Per-shift approval workflow**: mỗi shift được Sub Leader tương ứng approve riêng
- **Sub Leader dual role**: vừa là approver vừa là operator
- **Auto-abnormality detection**: NG > 5%, Downtime > 60 phút, OT không lý do
- **Bulk Approval** với filter Normal / Abnormal
- **Cross-midnight shift** validation cho Shift 3 (22:00 → 06:00 hôm sau)
- **seedFromPlan** từ Monthly Plan + IFS mock
- **Tablet-first UI**: Number Wheel Picker, Time Picker, touch targets ≥ 44px
- **VI/JA i18n** (Vietnamese operators + Japanese management)

## Tech Stack

- React 18 + Vite 6
- Tailwind CSS 3
- lucide-react (icons)
- recharts (charts)

## Technical Documents

Xem folder [`docs/`](./docs/) để có:

- **UserManual_TiengViet_v3.docx** — HDSD bằng tiếng Việt cho operator/leader
- **SRS_Production_Report_System.md** — Software Requirements Specification
- **Basic_Design_Production_Report_System.md** — Basic design document
- **PLAN_Demo_Production_Report_App.md** — Plan và tiến độ demo app

## License

Internal use — DanaExperts × Y-Nettech collaboration.
