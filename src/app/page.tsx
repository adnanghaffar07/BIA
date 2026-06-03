'use client';

import { Container, Box, Typography, Button, Grid, Card, CardContent, Stack } from '@mui/material';
import Link from 'next/link';
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

export default function Home() {
  return (
    <Container maxWidth="lg" sx={{ py: 8 }}>
      {/* Hero Section */}
      <Box sx={{ textAlign: 'center', mb: 8 }}>
        <Typography
          variant="h3"
          component="h1"
          sx={{
            fontWeight: 'bold',
            mb: 2,
            background: 'linear-gradient(45deg, #1976d2 30%, #1565c0 90%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          🏢 BIA CRM
        </Typography>
        <Typography
          variant="h6"
          color="textSecondary"
          sx={{ mb: 4, maxWidth: '600px', mx: 'auto' }}
        >
          Manage your real estate leads efficiently with our modern CRM platform. Connect to the BIA and track your prospects with ease.
        </Typography>
        <Button
          component={Link}
          href="/leads"
          variant="contained"
          size="large"
          sx={{
            px: 4,
            py: 1.5,
            fontSize: '1.1rem',
            boxShadow: 3,
            '&:hover': {
              boxShadow: 4,
              transform: 'translateY(-2px)',
              transition: 'all 0.3s ease',
            },
          }}
        >
          View Leads
        </Button>
      </Box>

      {/* Features Grid */}
      <Grid container spacing={3} sx={{ mb: 8 }}>
        <Grid xs={12} sm={6} md={4}>
          <Card sx={{ height: '100%', boxShadow: 2, '&:hover': { boxShadow: 4 } }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <BusinessIcon sx={{ fontSize: 40, color: '#1976d2', mb: 2 }} />
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                Lead Management
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Organize and manage all your real estate leads in one place
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid xs={12} sm={6} md={4}>
          <Card sx={{ height: '100%', boxShadow: 2, '&:hover': { boxShadow: 4 } }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <PeopleIcon sx={{ fontSize: 40, color: '#1976d2', mb: 2 }} />
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                Real-time Updates
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Get instant updates through BIA
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid xs={12} sm={6} md={4}>
          <Card sx={{ height: '100%', boxShadow: 2, '&:hover': { boxShadow: 4 } }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <TrendingUpIcon sx={{ fontSize: 40, color: '#1976d2', mb: 2 }} />
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                Analytics
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Track your sales pipeline and conversion rates
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Getting Started Section */}
      <Box sx={{ backgroundColor: '#f9f9f9', p: 4, borderRadius: 2, textAlign: 'center' }}>
        <Typography variant="h5" sx={{ mb: 3, fontWeight: 'bold' }}>
          Getting Started
        </Typography>
        {/* <Stack spacing={2} sx={{ textAlign: 'left', maxWidth: '600px', mx: 'auto' }}>
          <Typography variant="body1">
            ✅ <strong>API Configuration:</strong> Your API keys are already configured in .env.local
          </Typography>
          <Typography variant="body1">
            ✅ <strong>Database Ready:</strong> The backend is connected to the Real Estate API
          </Typography>
          <Typography variant="body1">
            ✅ <strong>UI Components:</strong> All necessary components are set up and ready to use
          </Typography>
        </Stack> */}
        <Button
          component={Link}
          href="/leads"
          variant="outlined"
          size="large"
          sx={{ mt: 3 }}
        >
          Start Managing Leads →
        </Button>
      </Box>
    </Container>
  );
}
