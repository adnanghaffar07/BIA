# Real Estate CRM Demo

A modern Real Estate CRM application built with Next.js 16, React 19, TypeScript, and Material-UI v9 to manage and display real estate leads from the Real Estate API.

## 🎯 Project Overview

This is a demo project showcasing a complete lead management system that connects to the Real Estate API (https://console.realestateapi.com/) to fetch, display, and manage real estate leads.

### Key Features

- **Lead Management Dashboard** - View all leads in a professional table interface
- **Advanced Search & Filtering** - Filter leads by name, status, property type, and more
- **Real-time Data** - Connected to Real Estate API for live lead data
- **Export Functionality** - Export leads to CSV format
- **Responsive Design** - Works seamlessly on desktop and mobile devices
- **Status Tracking** - Monitor lead status (New, Contacted, Qualified, Converted, Lost)
- **Lead Details** - Display comprehensive lead information including contact details, property info, and budget

## 📁 Project Structure

```
real-estate-crm-demo/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── leads/
│   │   │       └── route.ts           # API endpoint for leads
│   │   ├── leads/
│   │   │   └── page.tsx               # Leads management page
│   │   ├── layout.tsx                 # Root layout with navbar
│   │   ├── page.tsx                   # Home page
│   │   ├── globals.css                # Global styles
│   │   └── page.module.css
│   │
│   ├── components/
│   │   ├── Navbar.tsx                 # Navigation bar
│   │   ├── LeadsTable.tsx             # Table component for displaying leads
│   │   ├── SearchForm.tsx             # Search and filter form
│   │   └── LeadCard.tsx               # Individual lead card component
│   │
│   ├── lib/
│   │   ├── realEstateApi.ts           # Real Estate API client
│   │   └── constants.ts               # App constants and configurations
│   │
│   ├── services/
│   │   └── lead.service.ts            # Lead business logic service
│   │
│   ├── types/
│   │   ├── lead.ts                    # Lead TypeScript interfaces
│   │   └── api.ts                     # API response interfaces
│   │
│   └── utils/
│       ├── formatAddress.ts           # Formatting utilities
│       └── csvExport.ts               # CSV export functionality
│
├── public/                            # Static assets
├── .env.local                         # Environment variables (API keys)
├── package.json                       # Dependencies
├── tsconfig.json                      # TypeScript configuration
└── README.md                          # This file
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- API credentials for Real Estate API (API Key and Secret)

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   
   Create or update `.env.local` file with your Real Estate API credentials:
   ```
   NEXT_PUBLIC_REAL_ESTATE_API_KEY=your_api_key_here
   REAL_ESTATE_API_SECRET=your_api_secret_here
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   
   Navigate to http://localhost:3000

## 📖 Usage Guide

### Home Page
- Landing page with project overview and quick links
- Features cards showing key capabilities
- Quick navigation to leads management

### Leads Page (`/leads`)
- **View All Leads** - See a comprehensive table of all leads from the Real Estate API
- **Search Leads** - Search by name, email, or phone number
- **Filter by Status** - Filter leads by their current status
- **Filter by Property Type** - Filter by residential, commercial, etc.
- **Export Data** - Download leads as CSV file
- **Manage Leads** - View, edit, or delete individual leads

### Components

#### Navbar
- Navigation between Home and Leads pages
- Shows active page indicator

#### SearchForm
- Multi-field search and filter interface
- Dropdown selections for Status and Property Type
- Reset filters button

#### LeadsTable
- Scrollable table with sticky header
- Pagination support (5, 10, 25, 50 items per page)
- Status badges with color coding
- Action buttons (View, Edit, Delete)
- CSV export functionality

#### LeadCard
- Card-based display of lead information
- Shows contact, property, and financial details
- Formatted address and currency display

## 🔧 Key Features Explained

### API Integration
The `realEstateApi` class in [lib/realEstateApi.ts](lib/realEstateApi.ts) handles all communication with the Real Estate API:
- Fetch leads with pagination
- Get individual lead details
- Create, update, and delete leads

### Lead Service
[services/lead.service.ts](services/lead.service.ts) provides business logic:
- Fetch and format lead data
- Filter and sort operations
- Validation and error handling

### Data Formatting
[utils/formatAddress.ts](utils/formatAddress.ts) includes utilities for:
- Formatting addresses from components
- Phone number formatting
- Currency formatting
- Date/time formatting
- Text truncation

### Export Functionality
[utils/csvExport.ts](utils/csvExport.ts) provides:
- CSV export with proper header formatting
- JSON export option
- Automatic file download

## 🎨 UI/UX Design

The application uses Material-UI v9 for a professional, responsive design:
- **Responsive Layout** - Works on all screen sizes
- **Color Scheme** - Professional blue and gray tones
- **Icons** - Material-UI icons for better UX
- **Animations** - Smooth transitions and hover effects
- **Accessibility** - Semantic HTML and proper ARIA labels

## 🔐 Security

- API keys stored in `.env.local` (not committed to git)
- Private API key only used on server-side (API route)
- Public API key for client-side requests
- Environment variables properly scoped

## 📊 Data Types

### Lead
```typescript
interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType: string;
  budget: number;
  createdAt: string;
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  source: string;
  notes?: string;
}
```

## 🚦 Status Codes

- **New** - Recently added lead (Blue)
- **Contacted** - Initial contact made (Orange)
- **Qualified** - Lead verified and qualified (Purple)
- **Converted** - Lead converted to customer (Green)
- **Lost** - Lead no longer interested (Red)

## 🔄 Workflow

1. User navigates to `/leads`
2. Application fetches leads from API via `/api/leads`
3. Leads displayed in table format
4. User can search, filter, and sort leads
5. User can export leads to CSV
6. User can perform CRUD operations on leads

## 🛠️ Available Scripts

```bash
# Development server
npm run dev

# Production build
npm build

# Start production server
npm start

# Run linter
npm lint
```

## 📦 Dependencies

- **Next.js** - React framework
- **React** - UI library
- **TypeScript** - Type safety
- **Material-UI** - Component library
- **Emotion** - CSS-in-JS styling

## 🔗 API Endpoints

### Internal API Routes
- `GET /api/leads` - Fetch all leads with optional pagination and filters
- `POST /api/leads` - Create a new lead

### Real Estate API Routes (proxied through internal API)
- `GET /leads` - Fetch leads
- `GET /leads/{id}` - Get lead details
- `POST /leads` - Create lead
- `PUT /leads/{id}` - Update lead
- `DELETE /leads/{id}` - Delete lead

## 🚨 Troubleshooting

### API Connection Issues
- Verify API keys in `.env.local`
- Check Real Estate API service status
- Ensure network connectivity

### Module Not Found Errors
- Run `npm install` to ensure all dependencies are installed
- Clear `.next` folder and rebuild: `rm -rf .next && npm run build`

### TypeScript Errors
- Run `npm run lint` to check for issues
- Ensure all files are saved and TypeScript compiler is happy

## 📚 Next Steps & Future Enhancements

Potential features to add:
- Lead creation/editing modal
- Advanced filtering with date ranges
- Lead details page
- Bulk operations (delete, update status)
- Dashboard with analytics
- Lead notes history
- User authentication
- Email notifications
- Calendar/scheduling integration

## 🤝 Contributing

This is a demo project. Feel free to modify and extend it based on your needs.

## 📝 License

This project is part of a demo for Real Estate CRM management.

---

**Happy Lead Managing! 🏢📊**
