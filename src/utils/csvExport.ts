import { Lead } from '@/types/lead';

/**
 * Export properties to CSV format
 */
export const exportLeadsToCSV = (leads: Lead[]): void => {
  if (leads.length === 0) {
    alert('No properties to export');
    return;
  }

  // Define CSV headers
  const headers = [
    'ID',
    'Address',
    'City',
    'State',
    'Zip',
    'County',
    'Property Type',
    'Land Use',
    'Bedrooms',
    'Bathrooms',
    'Square Feet',
    'Year Built',
    'Est. Value',
    'Owner Company',
    'Owner Occupied',
    'Investor Buyer',
    'High Equity',
    'Pre-Foreclosure',
    'Status',
    'Notes',
  ];

  // Convert leads to CSV rows
  const rows = leads.map((lead) => [
    lead.id,
    lead.address?.street || '',
    lead.address?.city || '',
    lead.address?.state || '',
    lead.address?.zip || '',
    lead.address?.county || '',
    lead.propertyType || '',
    lead.landUse || '',
    lead.bedrooms || '',
    lead.bathrooms || '',
    lead.squareFeet || '',
    lead.yearBuilt || '',
    lead.estimatedValue || '',
    lead.companyName || '',
    lead.ownerOccupied ? 'Yes' : 'No',
    lead.investorBuyer ? 'Yes' : 'No',
    lead.highEquity ? 'Yes' : 'No',
    lead.preForeclosure ? 'Yes' : 'No',
    lead.status || '',
    lead.notes || '',
  ]);

  // Create CSV content
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row
        .map((cell) =>
          typeof cell === 'string' && cell.includes(',')
            ? `"${cell}"`
            : cell
        )
        .join(',')
    ),
  ].join('\n');

  // Create and download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `properties_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Export properties to JSON format
 */
export const exportLeadsToJSON = (leads: Lead[]): void => {
  if (leads.length === 0) {
    alert('No properties to export');
    return;
  }

  const jsonContent = JSON.stringify(leads, null, 2);
  const blob = new Blob([jsonContent], {
    type: 'application/json;charset=utf-8;',
  });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `properties_${new Date().toISOString().split('T')[0]}.json`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
