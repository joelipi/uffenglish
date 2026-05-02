// modules/appwrite.js
// IMPORTANT! THIS SCRIPT USES VERSION 24 OF APPWRITE, WHICH HAS MANY BREAKING CHANGES FROM EARLIER VERSIONS. DO NOT USE THE SYNTAX OR METHODS OF EARLIER VERSIONS WITHOUT CHECKING THEY ARE STILL VALID IN VERSION 24.

import { Client, Account, TablesDB, ID } from 'https://cdn.jsdelivr.net/npm/appwrite@24.2.0/+esm';

export const APPWRITE_CONFIG = {
    ENDPOINT: 'https://nyc.cloud.appwrite.io/v1',
    PROJECT_ID: '69e6faf4001ff72b2ac3',
    DATABASE_ID: '69e6fc160026cb28cf02',
    USER_PROFILES_TABLE_ID: 'userprofilestable' // Renamed for clarity
};

const client = new Client()
    .setEndpoint(APPWRITE_CONFIG.ENDPOINT)
    .setProject(APPWRITE_CONFIG.PROJECT_ID);

export const account = new Account(client);
export const tablesDB = new TablesDB(client); // Exporting tablesDB for v24
export { ID };

export async function getCurrentUser() {
    try {
        const user = await account.get();
        return user;
    } catch (error) {
        return null;
    }
}

export async function logout() {
    try {
        await account.deleteSession('current');
        return true;
    } catch (error) {
        console.error('Logout error:', error);
        return false;
    }
}