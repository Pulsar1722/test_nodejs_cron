'use strict';

const API_ROOT = "https://kusuri-miru-api-4b3a54cvqq-an.a.run.app/"; // レビュー情報を取得する際に用いるAPIのルートディレクトリ
const MAX_RANK = 5; // 上位何位までの薬のレーティング情報を取得するか
const GOOGLE_ANALYTICS_AUTH_JSON = "./google_analytics_auth.json" // Googleアナリティクスへのアクセス認証用JSONファイル
const GOOGLE_ANALYTICS_VIEW_ID = "228276979"; // 見たいGoogleアナリティクスのビューID


// レーティング情報を格納するオブジェクト
function RatingInfo(drugName, countRatings, avgRating) {
    this.drugName = drugName; // 薬の名称
    this.countRatings = countRatings; // 評価総数
    this.avgRating = avgRating; // 平均スコア
}

//使用モジュール
const cron = require('node-cron');
const axios = require('axios');
const { google } = require('googleapis'); // Google AnalyticsへのAPIアクセス用

if (require.main === module) {
    main();
}

/**
 * Main関数
 */
function main() {
    execFuncWithCron(" 0 */1 * * * ", getAndShowPopularDrugsRating, MAX_RANK); // 1時間に1回実行(毎時0分に実行) (環境によっては、UTC時間やJST時間など異なる時間で動く場合がある点に注意)
}

/**
 * cronを用いて、指定された周期で、指定したcallback関数を実行する
 * @param {string} cronStr -cronに渡す実行周期を示す文字列
 * @param {function} callback -cronを用いて実行するcallback関数
 * @param arg -callback関数に渡す引数
 * @note cronの周期指定は文字列を用いて行う。cronの周期指定文字列の書き方については、https://qiita.com/n0bisuke/items/66abf6ca1c12f495aa04 などを参照
 */
async function execFuncWithCron(cronStr, callback, arg) {
    try {
        cron.schedule(cronStr, () => {
            try {
                callback(arg);
            } catch (error) {
                console.log(`callback throw error ${error}`);
            }
        });
    } catch (error) {
        console.log(JSON.stringify(error));
    }
}

/**
 * 人気のある薬のレーティング情報を取得し、表示する関数
 * @param {Number} maxRank -上位何位までの薬のレーティング情報を取得するかを数値で指定する(上位5位まで取得する場合は"5"と指定)
 */
async function getAndShowPopularDrugsRating(maxRank) {

    let popularDrugIds = await getPopularDrugIds(maxRank); // GoogleアナリティクスからPV数順で上位の薬IDを取得する

    /** 一位から順に表示させたいので、同期的に行ってくれるこのfor文を使用 */
    for (let i = 0; i < popularDrugIds.length; i++) {
        let ratingInfo = await getDrugsRatingInfo(popularDrugIds[i]); // 薬IDからレーティング情報を取得
        showDrugsRating(ratingInfo); // レーティング情報の表示
    }
}

/**
 * 人気のある薬のIDを取得する
 * @param {Number} maxRank -上位何位までの薬のIDを取得するかを数値で指定する(上位5位まで取得する場合は"5"と指定)
 * @return 薬のIDをリストで返す
 * @note 人気のある薬は、Googleアナリティクスの薬ページのPV数から判断する
 */
async function getPopularDrugIds(maxRank) {
    let popularDrugIds = []; // 人気のある薬IDの格納先(添字[0]が一位)
    let json = await getGoogleAnalyticsData(maxRank); // GoogleアナリティクスからJSON形式でデータ取得

    // 以下のrowに、添字[0]から上位順にページ情報が格納されている
    json.reports[0].data.rows.forEach(async row => {
        let pagePath = row.dimensions[0]; // ページパス情報を取得
        let popularDrugIdTmp = pagePath.split("/")[2]; // URLのフォーマットとして、/medicine/{薬ID}/reviewsのようなURIを想定している
        popularDrugIds.push(popularDrugIdTmp);
    });

    return popularDrugIds;
}

/**
 * GoogleAnalyticsから上位PV数を持つページ情報をJSON方式で取得する
 * @param {Number} maxRank -上位何位までの薬のIDを取得するかを数値で指定する(上位5位まで取得する場合は"5"と指定)
 * @return ページ情報をJSON形式で返す
 * @note 収集期間は直近7日間とする
 * 参考URL1:https://fwywd.com/tech/ga-popular-node-ts
 * 参考URL2:https://dev.classmethod.jp/articles/ga-api-v4-node/
 */
async function getGoogleAnalyticsData(maxRank) {

    const client = await google.auth.getClient({
        keyFile: GOOGLE_ANALYTICS_AUTH_JSON, // キー JSON ファイルを配置した場所を指定する
        scopes: 'https://www.googleapis.com/auth/analytics.readonly',
    });

    const analyticsreporting = await google.analyticsreporting({
        version: 'v4',
        auth: client,
    });

    const res = await analyticsreporting.reports.batchGet({
        requestBody: {
            reportRequests: [
                {
                    // Google Analytics の View ID
                    viewId: GOOGLE_ANALYTICS_VIEW_ID,
                    // 期間(過去7日間)
                    dateRanges: [
                        {
                            startDate: '7daysAgo',
                            endDate: 'today',
                        },
                    ],
                    // 取得したい metrics
                    // 今回は PV 数のみ取得
                    metrics: [{ expression: 'ga:pageviews' }],
                    // 取得したい dimensions
                    // 今回はページのパスとタイトルのみ取得
                    dimensions: [{ name: 'ga:pagePath' }, { name: 'ga:pageTitle' }],
                    // 取得するページのフィルター設定
                    dimensionFilterClauses: [
                        {
                            operator: "AND", //　今は単一条件としてるが、今後複数の条件を設定した場合はAND条件となる
                            filters: [ // ページパスに"medicine"が含まれるものだけを取得する(トップページ"/"等を取得しないようにする)
                                {
                                    dimensionName: 'ga:pagePath', // ページパスを対象
                                    operator: 'PARTIAL', // 部分一致
                                    expressions: [
                                        "medicine", // 部分一致する文字列
                                    ]
                                    /** 本当は正規表現を使って正しいURIかどうかを確認するほうがかっこいいけど、今はこうする */
                                },
                            ]
                        }
                    ],
                    // 並び順
                    // 今回は PV を基準に、降順で取得
                    orderBys: [{ fieldName: 'ga:pageviews', sortOrder: 'DESCENDING' }],
                    // 取得数
                    pageSize: maxRank,
                },
            ],
        },
    });

    return res.data;
}

/**
 * 引数にて指定されたdrugIDに対応する薬の評価(レビュー)情報を取得し、コンソールに出力する関数
 * @param {List} drugId -レーティング情報を取得したい薬ID
 * @note ここでいうレーティング情報とは、評価の総数、および平均評価スコア(0~5)を示す。
 */
async function getDrugsRatingInfo(drugId) {

    let info = null; // 薬IDに紐づく薬の各種情報の格納先
    try {
        /** 薬情報をAPIから取得 */
        info = await axios.get(`${API_ROOT}/drugs/${drugId}`, {
            params: {
                // レビューは取得しない
                include_reviews: false,
            },
        });
    } catch (e) {
        throw e;
    }

    return new RatingInfo(info.data.name, info.data.count_ratings, info.data.avg_rating);
}

/**
 * 引数にて指定されたレーティング情報を表示する
 * @param {RatingInfo} ratingInfo -レーティング情報(配列でない)
 * @note ここでは、単純にconsole.logに出力するのみとする
 */
function showDrugsRating(ratingInfo) {
    console.log(`薬名:${ratingInfo.drugName} 評価総数:${ratingInfo.countRatings} 平均スコア:${ratingInfo.avgRating}`);
}