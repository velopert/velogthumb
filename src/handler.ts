import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import axios from 'axios';
import * as sharp from 'sharp';
import * as qs from 'qs';
import * as mimeTypes from 'mime-types';
import * as fs from 'fs';
import { Stream } from 'stream';
import * as sizeOf from 'image-size';
import etag from 'etag';

export const resize: Handler = async (event: APIGatewayEvent, context: Context, cb: Callback) => {
  // Check parameters
  const { url, width: widthRaw } = event.queryStringParameters;
  console.log('Request Headers:');
  console.log(event.headers);
  const ifNoneMatch = event.headers['If-None-Match'];
  const ifModifiedSince = event.headers['If-Modified-Since'];

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
    const response = await axios.get<Stream>(url, {
      responseType: 'stream'
    });

    // save file
    const extension = mimeTypes.extension(response.headers['content-type']) as string;
    const filename = `/tmp/image-${Date.now()}.${extension}`;
    const { data } = response;
    const stream = fs.createWriteStream(filename);
    data.pipe(stream);
    await new Promise((resolve, reject) => {
      data.on('end', () => {
        resolve();
      });
      data.on('error', () => {
        reject();
      });
    });
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      fs.readFile(filename, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    });

    const size = await sizeOf(filename);

    if (ifModifiedSince) {
      const date = new Date(ifModifiedSince);
      const currentDate = new Date(response.headers['last-modified']);
      if (currentDate <= date) {
        return {
          statusCode: 304,
          headers: {
            ETag: ifNoneMatch
          }
        };
      }
    }
    console.log('Response Headers:');
    console.log(response.headers);
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
          'cache-control': 'max-age=86400'
        }
      };
    }
    const nextSize = {
      width,
      height: Math.round((width / size.width) * size.height)
    };

    const resized = await sharp(buffer)
      .resize(nextSize.width, nextSize.height)
      .toFormat(extension === 'jpg' ? 'jpeg' : extension)
      .toBuffer();

    const ETag = etag(resized);
    if (ETag === ifNoneMatch) {
      return {
        statusCode: 304,
        headers: {
          ETag
        }
      };
    }
    return {
      statusCode: 200,
      body: resized.toString('base64'),
      headers: {
        'content-type': response.headers['content-type'],
        'last-modified': response.headers['last-modified'],
        'cache-control': 'max-age=86400',
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
