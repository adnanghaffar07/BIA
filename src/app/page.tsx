'use client';

import React, { useEffect, useState } from 'react';
import {
  Container,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Stack,
  CircularProgress,
  Chip,
  LinearProgress,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import GradeIcon from '@mui/icons-material/Grade';
import BlockIcon from '@mui/icons-material/Block';

interface PipelineSummary {
  total: number;
  engine1: number;
  engine2: number;
  unassigned: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  gradeD: number;
  quoteReady: number;
  bound: number;
}

function MetricCard({
  title,
  value,
  icon,
  color,
  description,
  loading,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  description: string;
  loading: boolean;
}) {
  return (
    <Card
      sx={{
        height: '100%',
        boxShadow: 2,
        borderTop: `4px solid ${color}`,
        transition: 'all 0.3s ease',
        '&:hover': { boxShadow: 4, transform: 'translateY(-4px)' },
      }}
    >
      <CardContent sx={{ p: 3, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2, color }}>
          {icon}
        </Box>
        {loading ? (
          <CircularProgress size={28} sx={{ color, mb: 1 }} />
        ) : (
          <Typography variant="h4" sx={{ fontWeight: 'bold', color, mb: 1 }}>
            {value.toLocaleString()}
          </Typography>
        )}
        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {description}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSummary(d.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const s = summary;
  const enrichmentRate = s && s.total > 0 ? Math.round(((s.total - s.gradeD) / s.total) * 100) : 0;
  const qualificationRate = s && s.total > 0 ? Math.round(((s.gradeA + s.gradeB) / s.total) * 100) : 0;
  const quoteReadyRate = s && s.total > 0 ? Math.round((s.gradeA / s.total) * 100) : 0;

  const topMetrics = [
    {
      title: 'Total Leads',
      value: s?.total ?? 0,
      icon: <FileDownloadIcon sx={{ fontSize: 40 }} />,
      color: '#2196f3',
      description: 'NJ properties stored in CRM',
    },
    {
      title: 'New Purchase',
      value: s?.engine1 ?? 0,
      icon: <HomeWorkIcon sx={{ fontSize: 40 }} />,
      color: '#4caf50',
      description: 'Engine 1 — mortgage within 90 days',
    },
    {
      title: 'Renewal Targets',
      value: s?.engine2 ?? 0,
      icon: <AutorenewIcon sx={{ fontSize: 40 }} />,
      color: '#ff9800',
      description: 'Engine 2 — 2022–2025 mortgages',
    },
    {
      title: 'Quote Ready',
      value: s?.quoteReady ?? 0,
      icon: <FactCheckIcon sx={{ fontSize: 40 }} />,
      color: '#9c27b0',
      description: 'Grade A — ready for producer',
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', py: 8, px: 2 }}>
      <Container maxWidth="lg">
        {/* Header */}
        <Box sx={{ mb: 6 }}>
          <Typography variant="h3" sx={{ fontWeight: 'bold', mb: 1 }}>
            Dashboard
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ fontSize: '1.1rem' }}>
            Live NJ homeowner insurance lead pipeline
          </Typography>
        </Box>

        {/* Top Metrics */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {topMetrics.map((metric) => (
            <Grid size={{ xs: 12, sm: 6, md: 3 }} key={metric.title}>
              <MetricCard {...metric} loading={loading} />
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={3}>
          {/* Grade Breakdown */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ boxShadow: 2, height: '100%' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 3 }}>
                  Lead Grade Breakdown
                </Typography>
                {loading ? (
                  <CircularProgress />
                ) : (
                  <Stack spacing={2}>
                    {[
                      { grade: 'A', label: 'Quote Ready', value: s?.gradeA ?? 0, color: '#2e7d32', bg: '#c8e6c9' },
                      { grade: 'B', label: 'Almost Ready', value: s?.gradeB ?? 0, color: '#e65100', bg: '#ffe0b2' },
                      { grade: 'C', label: 'Needs Information', value: s?.gradeC ?? 0, color: '#c62828', bg: '#ffcdd2' },
                      { grade: 'D', label: 'Disqualified', value: s?.gradeD ?? 0, color: '#757575', bg: '#f5f5f5' },
                    ].map(({ grade, label, value, color, bg }) => (
                      <Box key={grade}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                              label={grade}
                              size="small"
                              sx={{ backgroundColor: bg, color, fontWeight: 'bold', border: `1px solid ${color}` }}
                            />
                            <Typography variant="body2">{label}</Typography>
                          </Box>
                          <Typography variant="body2" sx={{ fontWeight: 'bold', color }}>
                            {value.toLocaleString()}
                          </Typography>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={s && s.total > 0 ? (value / s.total) * 100 : 0}
                          sx={{
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: '#f5f5f5',
                            '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 4 },
                          }}
                        />
                      </Box>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Pipeline Summary */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ boxShadow: 2, height: '100%' }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 3 }}>
                  Pipeline Summary
                </Typography>
                {loading ? (
                  <CircularProgress />
                ) : (
                  <Stack spacing={2}>
                    {[
                      { label: 'Total NJ Leads in CRM', value: s?.total ?? 0, color: '#2196f3' },
                      { label: 'Engine 1 — New Purchase', value: s?.engine1 ?? 0, color: '#4caf50' },
                      { label: 'Engine 2 — Renewal Targets', value: s?.engine2 ?? 0, color: '#ff9800' },
                      { label: 'Enrichment Rate', value: `${enrichmentRate}%`, color: '#4caf50' },
                      { label: 'Qualification Rate (A+B)', value: `${qualificationRate}%`, color: '#ff9800' },
                      { label: 'Quote Ready Rate (A only)', value: `${quoteReadyRate}%`, color: '#9c27b0' },
                      { label: 'Policies Bound', value: s?.bound ?? 0, color: '#1b5e20' },
                    ].map(({ label, value, color }) => (
                      <Box
                        key={label}
                        sx={{ display: 'flex', justifyContent: 'space-between', pb: 1.5, borderBottom: '1px solid #f0f0f0' }}
                      >
                        <Typography variant="body2">{label}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 'bold', color }}>
                          {typeof value === 'number' ? value.toLocaleString() : value}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
