import _ from "lodash-es";
import { useMerge } from "./use-merge";
import logger from "../utils/util.log";
import { reactive, UnwrapRef } from "vue";
import LRU from "lru-cache";
import { UnwrapNestedRefs } from "vue";

const DictGlobalCache = new LRU<string, any>({
  max: 500,
  maxSize: 5000,
  ttl: 1000 * 60 * 30,
  sizeCalculation: (value: any, key: any) => {
    // return an positive integer which is the size of the item,
    // if a positive integer is not returned, will use 0 as the size.
    return 1;
  }
}); //全局cache， sets just the max size

const { UnMergeable } = useMerge();

export type DictRequest = (req: { url: string; dict: Dict }) => Promise<any[]>;

function setDictRequest(request: DictRequest) {
  dictRequest = request;
}

let dictRequest = async (opts: any): Promise<any> => {
  logger.warn("请配置 app.use(FsCrud,{dictRequest:(context)=>{ 你的字典请求方法 }})");
  return [];
};

export type DictGetUrl = (context?: any) => string;
export type DictGetData<T> = (context?: any) => Promise<T[]>;

/**
 * Dict参数
 */
export interface DictOptions<T> {
  /**
   * dict请求url
   */
  url?: string | DictGetUrl;
  /**
   * 自定义获取data远程方法
   */
  getData?: DictGetData<T>;

  /**
   * 字典项value字段名称
   */
  value?: string;
  /**
   * 字典项label字段名称
   */
  label?: string;
  /**
   * 字典项children字段名称
   */
  children?: string;
  /**
   * 字典项color字段名称
   */
  color?: string;
  /**
   * 是否是树形
   */
  isTree?: boolean;
  /**
   * 是否全局缓存
   */
  cache?: boolean; // 获取到结果是否进行全局缓存
  /**
   * 是否将本dict当做原型，所有组件引用后将clone一个实例
   */
  prototype?: boolean; // 是否原型配置

  /**
   * dict创建后是否立即请求
   */
  immediate?: boolean; //是否立即请求

  /**
   * 根据values 远程获取字典，prototype=true时有效
   * @param values
   */
  getNodesByValues?: (values: any, options?: LoadDictOpts) => Promise<T[]>;

  /**
   * dict数据远程加载完后触发
   */
  onReady?: (context: any) => void;

  /**
   * 自定义参数
   */
  custom?: any;

  /**
   * 本地字典数据，无需远程请求
   */
  data?: T[];
}
export type LoadDictOpts = {
  reload?: boolean;
  value?: any;

  [key: string]: any;
};

type SuccessNotify = (data: any[]) => void | undefined;

export type DictOnReadyContext = {
  dict: Dict;
  [key: string]: any;
};
/**
 *
 * @param url
 * @param context = {dict, scope}
 * @returns {Promise<*>}
 */
export class Dict<T = any> extends UnMergeable implements DictOptions<T> {
  cache = false; // 获取到结果是否进行全局缓存
  prototype = false; // 是否原型配置
  immediate = true; //是否立即请求
  url?: string | DictGetUrl = undefined;
  getData?: DictGetData<T> = undefined;
  value = "value";
  label = "label";
  children = "children";
  color = "color";
  isTree = false;

  _data: null | T[] = null;
  get data() {
    return this._data;
  }
  set data(data: T[]) {
    this._data = data;
    this.toMap();
  }
  originalData?: T[] = undefined;
  dataMap: any = {};
  loading = false;
  custom = {};
  getNodesByValues?: (values: any, options?: LoadDictOpts) => Promise<T[]>;
  cacheNodes = {};
  onReady?: (context: DictOnReadyContext) => void = undefined;
  notifies: Array<any> = []; //loadDict成功后的通知
  constructor(dict: DictOptions<T>) {
    super();

    // 设置为不可枚举,就不会在clone的时候复制值，导致不会loadDict的bug
    Object.defineProperty(this, "loading", {
      value: false,
      enumerable: false
    });
    Object.defineProperty(this, "notifies", {
      value: false,
      enumerable: false
    });
    Object.defineProperty(this, "originalData", {
      value: null,
      enumerable: false
    });
    this.loading = false;
    _.merge(this, dict);
    if (dict.data != null) {
      this.originalData = dict.data;
      this.setData(dict.data);
    }
  }

  isDynamic() {
    return this.url instanceof Function || this.getData instanceof Function || this.prototype;
  }

  setData(data: any[]) {
    this.data = data;
    // this.toMap();
  }

  /**
   * 加载字典
   */
  async _loadDict(context: LoadDictOpts): Promise<any[]> {
    if (this.data && !context.reload) {
      return this.data;
    }

    if (this.loading) {
      let notify: SuccessNotify = null;
      //如果正在加载中，则等待加载完成
      const ret: Promise<any[]> = new Promise((resolve) => {
        notify = (data: any[]) => {
          resolve(data);
        };
      });
      if (!this.notifies) {
        this.notifies = [];
      }
      this.notifies.push(notify);
      return ret;
    }

    let data: any[] = null;
    if (this.getNodesByValues) {
      if (!this.prototype) {
        logger.warn("您配置了getNodesByValues，根据value值获取节点数据需要dict.prototype=true");
        return [];
      }

      if (context.value) {
        let cacheKey = null;
        if (this.cache && this.url) {
          cacheKey = this.url + context.value;
        }
        let cached = null;

        if (cacheKey) {
          // @ts-ignore
          cached = DictGlobalCache.get(cacheKey);
        }
        if (cached) {
          data = cached;
        } else {
          data = await this.getNodesByValues(context.value, context);
          if (cacheKey) {
            DictGlobalCache.set(cacheKey, data);
          }
        }
      }
    } else if (this.originalData) {
      data = this.originalData;
    } else {
      this.loading = true;
      try {
        data = await this.getRemoteDictData(context);
      } finally {
        this.loading = false;
      }
    }
    this.data = data;
    if (this.onReady) {
      this.onReady({ dict: this, ...context });
    }
    // notify
    if (this.notifies && this.notifies.length > 0) {
      _.forEach(this.notifies, (call) => {
        call(this.data);
      });
      this.notifies.length = 0;
    }
  }

  /**
   * 加载字典
   * @param context 当prototype=true时会传入
   */
  async loadDict(context?: any) {
    return this._loadDict({ ...context });
  }

  async reloadDict(context?: any) {
    return this.loadDict({ ...context, reload: true });
  }

  clear() {
    this.data = null;
    this.dataMap = {};
  }

  async getRemoteDictData(context?: any) {
    let getFromRemote;
    let cacheKey;
    let url: any;
    if (this.url) {
      url = this.url;
      if (url instanceof Function) {
        url = url({ ...context, dict: this });
      }
      cacheKey = url;
    }
    if (this.getData != null) {
      getFromRemote = async () => {
        // @ts-ignore
        return await this.getData({ url, dict: this, ...context });
      };
    } else if (url) {
      getFromRemote = async () => {
        return await dictRequest({ url, dict: this });
      };
    } else {
      return [];
    }
    if (this.cache && cacheKey) {
      let cached = DictGlobalCache.get(cacheKey);

      if (cached == null) {
        cached = {
          loaded: false,
          loading: true,
          data: undefined,
          callback: []
        };
        DictGlobalCache.set(cacheKey, cached);
      } else if (cached.loaded) {
        return cached.data;
      } else if (cached.loading) {
        return new Promise((resolve) => {
          const callback = (data: any) => {
            resolve(data);
          };
          cached.callback.push(callback);
        });
      }

      try {
        cached.loaded = false;
        cached.loading = true;
        const dictData = await getFromRemote();
        if (!(dictData instanceof Array)) {
          logger.warn("dict data 格式有误，期望格式为数组，实际格式为：", dictData);
        }
        cached.data = dictData;
        cached.loaded = true;
        cached.loading = false;
        for (const callback of cached.callback) {
          callback(dictData);
        }
        cached.callback = [];
        return dictData;
      } catch (e) {
        cached.loading = false;
        cached.loaded = false;
        logger.error("load dict error:", e);
      }
    }

    return await getFromRemote();
  }

  toMap() {
    const map = {};
    if (this.data) {
      this.buildMap(map, this.data);
    }
    // if (this.getNodesByValues) {
    //   _.merge(this.dataMap, map);
    // }
    this.dataMap = map;
  }
  buildMap(map: any, list: any) {
    _.forEach(list, (item) => {
      map[this.getValue(item)] = item;
      if (this.isTree && this.getChildren(item)) {
        this.buildMap(map, this.getChildren(item));
      }
    });
  }

  getValue(item: any) {
    return item[this.value];
  }
  getLabel(item: any) {
    return item[this.label];
  }
  getChildren(item: any) {
    return item[this.children];
  }
  getColor(item: any) {
    return item[this.color];
  }
  getDictData() {
    return this.data;
  }

  getDictMap() {
    return this.dataMap;
  }

  getNodeByValue(value: any) {
    return this.dataMap[value];
  }

  getNodesFromDataMap(value: any) {
    if (value == null) {
      return [];
    }
    if (!_.isArray(value)) {
      value = [value];
    }
    //本地获取
    const nodes: Array<any> = [];
    _.forEach(value, (item) => {
      const node = this.dataMap[item];
      if (node) {
        nodes.push(node);
      } else {
        nodes.push({ [this.value]: item });
      }
    });
    return nodes;
  }
}

/**
 * 创建Dict对象
 * 注意：这里只能定义返回<any>,否则build结果会缺失index.d.ts
 * @param config
 */
export function dict<T = any>(config: DictOptions<T>): UnwrapNestedRefs<Dict<any>> {
  const ret = reactive(new Dict(config));
  if (!ret.prototype && ret.immediate) {
    ret.loadDict();
  }
  return ret;
}
export function useDictDefine() {
  return {
    dict,
    setDictRequest,
    Dict
  };
}
