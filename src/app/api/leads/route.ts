import { NextRequest, NextResponse } from 'next/server';
import { PropertySearchRequest } from '@/types/api';
import { ERROR_MESSAGES, API_CONFIG } from '@/lib/constants';

/**
 * GET /api/leads
 * Fetch all properties from Real Estate API
 */
export async function GET(request: NextRequest) {
  try {
    if (!API_CONFIG.API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: 'API Key not configured',
        },
        { status: 500 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const size = parseInt(searchParams.get('size') || '20', 10);

    const requestBody: PropertySearchRequest = {
      ids_only: false,
      obfuscate: false,
      summary: false,
      size: size,
    };

    console.log('📤 Real Estate API Request Payload:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(
      `${API_CONFIG.BASE_URL}/PropertySearch`,
      {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'x-api-key': API_CONFIG.API_KEY,
          'x-user-id': API_CONFIG.USER_ID,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Real Estate API Error:', response.statusText, errorText);
      throw new Error(`Real Estate API Error: ${response.statusText}`);
    }

    const data = await response.json();
    
    console.log('📥 Real Estate API Response:', {
      statusCode: data.statusCode,
      resultCount: data.resultCount,
      recordCount: data.recordCount,
      statusMessage: data.statusMessage,
    });

    return NextResponse.json({
      success: true,
      data: data.data || [],
      total: data.resultCount || 0,
      payload: requestBody,
    });
  } catch (error) {
    console.error('API Error:', error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : ERROR_MESSAGES.FETCH_LEADS_FAILED,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leads
 * Search properties with advanced filters
 */
export async function POST(request: NextRequest) {
  try {
    if (!API_CONFIG.API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: 'API Key not configured',
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const requestBody: PropertySearchRequest = {
      ids_only: body.ids_only || false,
      obfuscate: body.obfuscate || false,
      summary: body.summary || false,
      size: body.size || 20,
    };

    console.log('📤 Real Estate API Request Payload:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(
      `${API_CONFIG.BASE_URL}/PropertySearch`,
      {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'x-api-key': API_CONFIG.API_KEY,
          'x-user-id': API_CONFIG.USER_ID,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Real Estate API Error:', response.statusText, errorText);
      throw new Error(`Real Estate API Error: ${response.statusText}`);
    }

    const data = await response.json();
    
    console.log('📥 Real Estate API Response:', {
      statusCode: data.statusCode,
      resultCount: data.resultCount,
      recordCount: data.recordCount,
      statusMessage: data.statusMessage,
    });

    return NextResponse.json(
      {
        success: true,
        data: data.data || [],
        total: data.resultCount || 0,
        payload: requestBody,
        message: 'Properties fetched successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('API Error:', error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : ERROR_MESSAGES.FETCH_LEADS_FAILED,
      },
      { status: 500 }
    );
  }
}
