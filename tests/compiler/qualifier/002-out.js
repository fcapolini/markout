({
  __id: 0,
  __children: [
    {
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
          x: {
            e: function() {
              return () => {
                const z = 1;
                return z + this.y;
              }
            }
          },
          y: {
            e: function() { return 1; }
          },
          __children: []
        },
      ]
    }
  ]
})
