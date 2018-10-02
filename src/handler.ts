import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import axios from 'axios';
import * as sharp from 'sharp';
import * as qs from 'qs';
import * as mimeTypes from 'mime-types';
import * as fs from 'fs';
import { Stream } from 'stream';
import * as sizeOf from 'image-size';

export const resize: Handler = async (event: APIGatewayEvent, context: Context, cb: Callback) => {
  console.log(JSON.stringify(event, null, 2));
  // Check parameters
  const { url, width: widthRaw } = event.queryStringParameters;
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
    if (size.width <= width) {
      // return original
      return {
        statusCode: 200,
        body: buffer.toString('base64'),
        isBase64Encoded: true,
        headers: {
          'content-type': response.headers['content-type']
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
    return {
      statusCode: 200,
      body: resized.toString('base64'),
      headers: {
        'content-type': response.headers['content-type']
      },
      isBase64Encoded: true
    };

    return {
      statusCode: 200,
      body: JSON.stringify(nextSize)
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
