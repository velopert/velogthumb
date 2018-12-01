import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import axios from 'axios';
import * as sharp from 'sharp';
import * as qs from 'qs';
import * as mimeTypes from 'mime-types';
import * as fs from 'fs';
import { Stream } from 'stream';
import * as sizeOf from 'image-size';
import etag from 'etag';
import * as URL from 'url';

export const resize: Handler = async (event: APIGatewayEvent, context: Context, cb: Callback) => {
  // Check parameters
  const { url, width: widthRaw } = event.queryStringParameters;

  const urlParts = URL.parse(url);

  const allowedHosts = ['images.velog.io'];
  if (!allowedHosts.includes(urlParts.host)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: {
          name: 'NOT_ALLOWED_HOST'
        }
      })
    };
  }

  if (!url || !widthRaw) {
    return {
      statusCode: 400,
      body: JSON.stringify(event)
    };
  }
  const width = parseInt(widthRaw, 10);
  if (isNaN(width)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: {
          name: 'INVALID_WIDTH'
        }
      })
    };
  }

  try {
    const response = await axios.get<any>(encodeURI(url), {
      responseType: 'arraybuffer'
    });

    const buffer = new Buffer(response.data, 'binary');

    const size = await sizeOf(buffer);

    if (size.width <= width) {
      // return original
      return {
        statusCode: 200,
        body: buffer.toString('base64'),
        isBase64Encoded: true,
        headers: {
          'content-type': response.headers['content-type'],
          'Last-Modified': response.headers['last-modified'],
          ETag: response.headers['etag'],
          'cache-control': 'max-age=604800'
        }
      };
    }

    const nextSize = {
      width,
      height: Math.round((width / size.width) * size.height)
    };

    const resized = await sharp(buffer)
      .resize(nextSize.width, nextSize.height)
      .toFormat('png')
      .toBuffer();

    const ETag = etag(resized);
    return {
      statusCode: 200,
      body: resized.toString('base64'),
      headers: {
        'content-type': 'image/png',
        'last-modified': response.headers['last-modified'],
        'cache-control': 'max-age=604800',
        ETag
      },
      isBase64Encoded: true
    };
  } catch (e) {
    console.log(e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: {
          name: 'DOWNLOAD_FAILURE'
        }
      })
    };
    return;
  }
};
