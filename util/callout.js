import axios from 'axios';

import { API_BASES, REQUEST_HEADERS } from '../config';
import { fatal } from './error.js';

async function get({site, endpoint, fullUrl}) {
    try {
        const res = await axios.get(
            fullUrl ? fullUrl : `${API_BASES[site]}${endpoint}`,
            {
                headers: REQUEST_HEADERS[site]
            },
        );
        return res.data;
    } catch(err) {
        fatal('get()', err);
    }
}

function generateRequest(site, endpoint, body) {
    let request;
    if(body) {
        request = [
            `${API_BASES[site]}${endpoint}`,
            body,
            {headers: REQUEST_HEADERS[site]}
        ];
    } else {
        request = [
            `${API_BASES[site]}${endpoint}`,
            {headers: REQUEST_HEADERS[site]}
        ]
    }
    return request;
}

async function patch(site, endpoint, body) {
    try {
        const res = await axios.patch(...generateRequest(site, endpoint, body));
        return res.data;
    } catch(err) {
        fatal('patch()', err);
    }
}

async function post(site, endpoint, body) {
    try {
        const res = await axios.post(...generateRequest(site, endpoint, body));
        return res.data;
    } catch(err) {
        fatal('post()', err);
    }
}

async function put(site, endpoint, body) {
    try {
        const res = await axios.put(...generateRequest(site, endpoint, body));
        return res.data;
    } catch(err) {
        fatal('put()', err);
    }
}

async function doDelete(site, endpoint) {
    try {
        const res = await axios.delete(...generateRequest(site, endpoint));
        return res.data;
    } catch(err) {
        fatal('doDelete()', err);
    }
}

export {
    doDelete,
    get,
    patch,
    post,
    put
}