({
  __id: 0,
  __children: [{
    __id: 1,
    __name: 'page',
    __children: [
      {
        __id: 2,
        __name: 'head',
        __children: []
      },
      {
        __id: 3,
        __name: 'body',
        __children: [{
          __id: 4,
          __type: 'foreach',
          data: {
            e: function () { return [1, 2]; }
          },
          __children: [{
            __id: 5,
            data: {
              e: function () { return ''; }
            },
            text_5_0: {
              e: function () { return this.data; },
              r: [function () { return this.__value('data'); }]
            },
            __children: []
          }]
        }]
      }
    ]
  }]
});
