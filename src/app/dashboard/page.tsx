'use client';

import { Container, Box, Typography, Grid, Card, CardContent, Stack } from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import FactCheckIcon from '@mui/icons-material/FactCheck';

interface MetricCard {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  description: string;
}

export default function Dashboard() {
  const metrics: MetricCard[] = [
    {
      title: 'Imported',
      value: 5000,
      icon: <FileDownloadIcon sx={{ fontSize: 40 }} />,
      color: '#2196f3',
      description: 'Total leads imported',
    },
    {
      title: 'Enriched',
      value: 4600,
      icon: <CheckCircleIcon sx={{ fontSize: 40 }} />,
      color: '#4caf50',
      description: 'Leads enriched with data',
    },
    {
      title: 'Passed Appetite',
      value: 2100,
      icon: <TrendingUpIcon sx={{ fontSize: 40 }} />,
      color: '#ff9800',
      description: 'Qualified leads',
    },
    {
      title: 'Quote Ready',
      value: 950,
      icon: <FactCheckIcon sx={{ fontSize: 40 }} />,
      color: '#9c27b0',
      description: 'Ready for quotation',
    },
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 8 }}>
      {/* Header Section */}
      <Box sx={{ mb: 8 }}>
        <Typography
          variant="h3"
          sx={{
            fontWeight: 'bold',
            mb: 2,
          }}
        >
          Dashboard
        </Typography>
        <Typography variant="body1" color="textSecondary" sx={{ fontSize: '1.1rem' }}>
          Overview of your lead pipeline and enrichment metrics
        </Typography>
      </Box>

      {/* Metrics Grid */}
      <Grid container spacing={3} sx={{ mb: 6 }}>
        {metrics.map((metric, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Card
              sx={{
                height: '100%',
                boxShadow: 2,
                borderTop: `4px solid ${metric.color}`,
                transition: 'all 0.3s ease',
                '&:hover': {
                  boxShadow: 4,
                  transform: 'translateY(-4px)',
                },
              }}
            >
              <CardContent sx={{ p: 3 }}>
                {/* Icon */}
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    mb: 2,
                    color: metric.color,
                  }}
                >
                  {metric.icon}
                </Box>

                {/* Value */}
                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 'bold',
                    textAlign: 'center',
                    mb: 1,
                    color: metric.color,
                  }}
                >
                  {metric.value.toLocaleString()}
                </Typography>

                {/* Title */}
                <Typography
                  variant="h6"
                  sx={{
                    textAlign: 'center',
                    mb: 1,
                    fontWeight: 'bold',
                  }}
                >
                  {metric.title}
                </Typography>

                {/* Description */}
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ textAlign: 'center' }}
                >
                  {metric.description}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Summary Section */}
      <Card sx={{ boxShadow: 2, p: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 3 }}>
          Pipeline Summary
        </Typography>
        <Stack spacing={2}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              pb: 2,
              borderBottom: '1px solid #e0e0e0',
            }}
          >
            <Typography>Total Leads Imported</Typography>
            <Typography sx={{ fontWeight: 'bold', color: '#2196f3' }}>5,000</Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              pb: 2,
              borderBottom: '1px solid #e0e0e0',
            }}
          >
            <Typography>Enrichment Rate</Typography>
            <Typography sx={{ fontWeight: 'bold', color: '#4caf50' }}>92%</Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              pb: 2,
              borderBottom: '1px solid #e0e0e0',
            }}
          >
            <Typography>Qualification Rate</Typography>
            <Typography sx={{ fontWeight: 'bold', color: '#ff9800' }}>42%</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography>Quote Conversion Rate</Typography>
            <Typography sx={{ fontWeight: 'bold', color: '#9c27b0' }}>19%</Typography>
          </Box>
        </Stack>
      </Card>
    </Container>
  );
}
